'use strict';

// Tests for api/observations.js. No real SMTP connection is ever made: a mock
// mailer is injected before any handler call, and logs and outbox output are
// captured in memory.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../api/observations.js');
const { validate, detectType, safeFilename, buildMessage, createReference, limits, RECIPIENT } = handler;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SIGNATURES = {
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]),
  gif: Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00', 'latin1'),
  webp: Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')]),
  heic: Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.from([0, 0, 0, 0])]),
  heif: Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmif1'), Buffer.from([0, 0, 0, 0])]),
  pdf: Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1'),
  text: Buffer.from('The kiosk now says “Take your time.”\nNobody did.\n', 'utf8'),
};

const EMAIL = 'sender@example.com';
const NAME = 'Sabine Hartmann';
const CONTEXT = 'legal translator, Vienna';
const MATERIAL = 'I have translated contracts between German and English for nineteen years.';

function submission(overrides = {}) {
  return { material: MATERIAL, name: NAME, context: CONTEXT, email: EMAIL, website: '', ...overrides };
}

function attachment(bytes, overrides = {}) {
  return { name: 'photo.jpg', data: bytes.toString('base64'), prepared: false, originalBytes: bytes.length, ...overrides };
}

function mockReq(body, { method = 'POST', headers = {} } = {}) {
  const json = body === undefined ? '' : JSON.stringify(body);
  return {
    method,
    headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(json)), ...headers },
    body,
  };
}

function mockRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.setHeader = (key, value) => { res.headers[key.toLowerCase()] = value; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.end = () => res;
  return res;
}

let sent;
let logs;
let outbox;

function useMailer(sendMail) {
  handler._setMailer({ createTransport: (options) => ({ sendMail: (message) => sendMail(message, options) }) });
}

beforeEach(() => {
  sent = [];
  logs = [];
  outbox = '';
  useMailer(async (message, options) => { sent.push({ message, options }); });
  handler._setLog((line) => logs.push(line));
  handler._setOutput({ write: (chunk) => { outbox += chunk; } });
  process.env.SMTP_USER = 'relay@workspace.example';
  process.env.SMTP_PASS = 'test-app-password';
  process.env.SMTP_FROM = 'mail@probnaya.work';
  delete process.env.OBSERVATIONS_DEV_OUTBOX;
  delete process.env.VERCEL;
});

async function call(body, options) {
  const req = mockReq(body, options);
  const res = mockRes();
  await handler(req, res);
  return res;
}

// Every log line must be a bounded JSON record that never carries personal data.
function assertLogsClean(extra = []) {
  for (const line of logs) {
    const record = JSON.parse(line);
    assert.equal(record.event, 'observations.request');
    for (const secret of [EMAIL, NAME, CONTEXT, MATERIAL, 'photo', 'test-app-password', ...extra]) {
      assert.ok(!line.includes(secret), `log line leaks "${secret}": ${line}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Method, content type, and size
// ---------------------------------------------------------------------------

test('refuses methods other than POST', async () => {
  const res = await call(undefined, { method: 'GET' });
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'POST');
  assert.equal(res.body.code, 'method_not_allowed');
  assert.equal(sent.length, 0);
});

test('refuses a non-JSON content type', async () => {
  const res = await call(submission(), { headers: { 'content-type': 'multipart/form-data; boundary=x' } });
  assert.equal(res.statusCode, 415);
  assert.equal(sent.length, 0);
});

test('refuses a declared Content-Length above 4.4 MB before reading the body', async () => {
  const res = await call(submission(), { headers: { 'content-length': String(limits.MAX_REQUEST_BYTES + 1) } });
  assert.equal(res.statusCode, 413);
  assert.equal(res.body.code, 'payload_too_large');
  assert.equal(sent.length, 0);
});

test('refuses a parsed body above 4.4 MB even without a Content-Length', async () => {
  const req = mockReq(submission({ material: 'x', attachment: attachment(Buffer.alloc(10)) }));
  delete req.headers['content-length'];
  req.body.attachment.data = 'A'.repeat(limits.MAX_REQUEST_BYTES);
  const res = mockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 413);
  assert.equal(sent.length, 0);
});

test('refuses malformed JSON surfaced by the platform body parser', async () => {
  const req = mockReq(undefined);
  Object.defineProperty(req, 'body', { get() { throw new SyntaxError('Unexpected token'); } });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'malformed_json');
});

test('refuses a body that is not an object', async () => {
  for (const body of [[], 'text', 42, null]) {
    const res = await call(body);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'invalid_request');
  }
  assert.equal(sent.length, 0);
});

test('responses are never cached and never sniffed', async () => {
  const res = await call(submission());
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

test('accepts a complete submission and sends exactly one message', async () => {
  const res = await call(submission());
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(sent.length, 1);
});

test('material is required and whitespace does not count', async () => {
  for (const material of [undefined, '', '   \n\t ']) {
    const res = await call(submission({ material }));
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'material_required');
    assert.equal(res.body.field, 'material');
  }
  assert.equal(sent.length, 0);
});

test('material accepts exactly 40,000 characters and refuses one more', async () => {
  assert.equal((await call(submission({ material: 'a'.repeat(limits.MAX_MATERIAL) }))).statusCode, 200);
  const res = await call(submission({ material: 'a'.repeat(limits.MAX_MATERIAL + 1) }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'material_too_long');
});

test('material keeps its paragraphs and punctuation, normalises line endings, and drops control characters', () => {
  const result = validate(submission({ material: '  First “line”.\r\n\r\nSecond — line.\x07\rThird\x00.  ' }));
  assert.equal(result.ok, true);
  assert.equal(result.value.material, 'First “line”.\n\nSecond — line.\nThird.');
});

test('name and context are optional; a blank name is unsigned', async () => {
  const res = await call(submission({ name: '   ', context: undefined }));
  assert.equal(res.statusCode, 200);
  assert.match(sent[0].message.text, /^FROM {7}UNSIGNED$/m);
  assert.match(sent[0].message.text, /^CONTEXT {4}—$/m);
});

test('name and context limits', async () => {
  assert.equal((await call(submission({ name: 'n'.repeat(limits.MAX_NAME) }))).statusCode, 200);
  assert.equal((await call(submission({ name: 'n'.repeat(limits.MAX_NAME + 1) }))).body.code, 'name_too_long');
  assert.equal((await call(submission({ context: 'c'.repeat(limits.MAX_CONTEXT) }))).statusCode, 200);
  assert.equal((await call(submission({ context: 'c'.repeat(limits.MAX_CONTEXT + 1) }))).body.code, 'context_too_long');
});

test('single-line fields cannot carry line breaks or control characters into the message headers', () => {
  const result = validate(submission({
    name: 'Ada\r\nBcc: victim@example.com',
    context: 'line\none',
    email: 'sender@example.com',
  }));
  assert.equal(result.ok, true);
  assert.equal(result.value.name, 'Ada Bcc: victim@example.com');
  assert.equal(result.value.context, 'line one');
});

test('email is required, bounded, and must look like an address', async () => {
  assert.equal((await call(submission({ email: '' }))).body.code, 'email_required');
  assert.equal((await call(submission({ email: `${'a'.repeat(200)}@example.com` }))).body.code, 'email_too_long');
  for (const email of ['no-at-sign', 'a@b', 'a b@example.com', 'a@example.com\r\nBcc: x@example.com', '<a@example.com>']) {
    const res = await call(submission({ email }));
    assert.equal(res.statusCode, 400, email);
    assert.equal(res.body.field, 'email');
  }
  assert.equal(sent.length, 0);
});

test('non-string fields are refused', async () => {
  const res = await call(submission({ name: { toString: 'x' } }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'invalid_request');
  assert.equal(res.body.field, 'name');
});

test('the honeypot is accepted silently: nothing is sent and nothing is logged', async () => {
  const res = await call(submission({ website: 'https://spam.example' }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(sent.length, 0);
  assert.equal(logs.length, 0);
});

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

test('detects every accepted content signature', () => {
  assert.deepEqual(detectType(SIGNATURES.jpeg), { mime: 'image/jpeg', ext: 'jpg' });
  assert.deepEqual(detectType(SIGNATURES.png), { mime: 'image/png', ext: 'png' });
  assert.deepEqual(detectType(SIGNATURES.gif), { mime: 'image/gif', ext: 'gif' });
  assert.deepEqual(detectType(SIGNATURES.webp), { mime: 'image/webp', ext: 'webp' });
  assert.deepEqual(detectType(SIGNATURES.heic), { mime: 'image/heic', ext: 'heic' });
  assert.deepEqual(detectType(SIGNATURES.heif), { mime: 'image/heif', ext: 'heif' });
  assert.deepEqual(detectType(SIGNATURES.pdf), { mime: 'application/pdf', ext: 'pdf' });
  assert.deepEqual(detectType(SIGNATURES.text), { mime: 'text/plain; charset=utf-8', ext: 'txt' });
});

test('refuses content without an accepted signature', () => {
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
  const exe = Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00', 'latin1');
  const binary = Buffer.from([0x00, 0xff, 0xfe, 0x10, 0x80, 0x81]);
  const invalidUtf8 = Buffer.from([0x68, 0x69, 0xc3, 0x28]);
  const controlText = Buffer.from('plain\x1bescape', 'latin1');
  for (const bytes of [zip, exe, binary, invalidUtf8, controlText]) assert.equal(detectType(bytes), null);
});

test('the content type follows the bytes, not the declared name or type', async () => {
  const res = await call(submission({ attachment: attachment(SIGNATURES.png, { name: 'holiday.jpg', type: 'image/jpeg' }) }));
  assert.equal(res.statusCode, 200);
  const [file] = sent[0].message.attachments;
  assert.equal(file.contentType, 'image/png');
  assert.equal(file.filename, 'holiday.png');
  assert.deepEqual(file.content, SIGNATURES.png);
});

test('an SVG or HTML file is treated as plain text, never as markup', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const res = await call(submission({ attachment: attachment(svg, { name: 'image.svg' }) }));
  assert.equal(res.statusCode, 200);
  const [file] = sent[0].message.attachments;
  assert.equal(file.contentType, 'text/plain; charset=utf-8');
  assert.equal(file.filename, 'image.txt');
});

test('refuses an unsupported attachment with 415', async () => {
  const res = await call(submission({ attachment: attachment(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4])) }));
  assert.equal(res.statusCode, 415);
  assert.equal(res.body.code, 'unsupported_attachment');
  assert.equal(sent.length, 0);
});

test('accepts an attachment of exactly 3.1 MB and refuses one byte more', async () => {
  const exact = Buffer.alloc(limits.MAX_ATTACHMENT_BYTES, 0x61);
  SIGNATURES.jpeg.copy(exact);
  assert.equal((await call(submission({ attachment: attachment(exact) }))).statusCode, 200);

  const over = Buffer.alloc(limits.MAX_ATTACHMENT_BYTES + 1, 0x61);
  SIGNATURES.jpeg.copy(over);
  const res = await call(submission({ attachment: attachment(over) }));
  assert.equal(res.statusCode, 413);
  assert.equal(res.body.code, 'attachment_too_large');
});

test('refuses malformed attachment data', async () => {
  for (const data of ['', 'not base64!', 'abc', 42]) {
    const res = await call(submission({ attachment: { name: 'a.jpg', data } }));
    assert.equal(res.statusCode, 400, String(data));
    assert.equal(res.body.code, 'invalid_attachment');
  }
  for (const value of ['string', [attachment(SIGNATURES.jpeg)]]) {
    const res = await call(submission({ attachment: value }));
    assert.equal(res.statusCode, 400);
  }
  assert.equal(sent.length, 0);
});

test('file names are reduced to a safe basename with the detected extension', () => {
  assert.equal(safeFilename('../../etc/passwd.jpg', 'jpg'), 'passwd.jpg');
  assert.equal(safeFilename('C:\\Users\\me\\IMG_0042.HEIC', 'heic'), 'IMG_0042.heic');
  assert.equal(safeFilename('bad"<name>|?*.png', 'png'), 'badname.png');
  assert.equal(safeFilename('...', 'pdf'), 'attachment.pdf');
  assert.equal(safeFilename(undefined, 'txt'), 'attachment.txt');
  assert.ok(safeFilename('x'.repeat(500) + '.jpg', 'jpg').length <= limits.MAX_FILENAME);
});

test('the largest permitted submission fits under the 4.4 MB guard', async () => {
  const bytes = Buffer.alloc(limits.MAX_ATTACHMENT_BYTES, 0x61);
  SIGNATURES.jpeg.copy(bytes);
  const body = submission({
    material: '—'.repeat(limits.MAX_MATERIAL), // three UTF-8 bytes each
    name: 'n'.repeat(limits.MAX_NAME),
    context: 'c'.repeat(limits.MAX_CONTEXT),
    attachment: attachment(bytes, { name: 'x'.repeat(200) + '.jpg', prepared: true }),
  });
  const size = Buffer.byteLength(JSON.stringify(body));
  assert.ok(size <= limits.MAX_REQUEST_BYTES, `${size} bytes`);
  assert.ok(size < 4_500_000);
  assert.equal((await call(body)).statusCode, 200);
});

// ---------------------------------------------------------------------------
// The message
// ---------------------------------------------------------------------------

test('the message goes only to the PROBNAYA mailbox, from the configured sender, replying to the sender', async () => {
  await call(submission({ attachment: attachment(SIGNATURES.jpeg, { prepared: true, originalBytes: 8_400_000 }) }));
  const { message, options } = sent[0];
  assert.equal(message.to, RECIPIENT);
  assert.equal(message.to, 'mail@probnaya.work');
  assert.equal(message.from, 'mail@probnaya.work');
  assert.deepEqual(message.replyTo, { name: '', address: EMAIL });
  assert.equal(message.cc, undefined);
  assert.equal(message.bcc, undefined);
  assert.equal(message.html, undefined);
  assert.match(message.subject, /^OBSERVATION \/ RECEIVED O–[A-HJ-NP-Z2-9]{6}$/);

  assert.equal(options.host, 'smtp.gmail.com');
  assert.equal(options.port, 465);
  assert.equal(options.secure, true);
  assert.equal(options.disableFileAccess, true);
  assert.equal(options.disableUrlAccess, true);
});

test('the message text carries the material exactly and marks the email as private', async () => {
  const material = 'First paragraph.\n\nSecond “paragraph” — with <angle> & ampersand.';
  await call(submission({ material, attachment: attachment(SIGNATURES.jpeg, { prepared: true, originalBytes: 8_400_000 }) }));
  const { text } = sent[0].message;
  assert.ok(text.includes(`--- MATERIAL, AS SENT ---\n${material}\n--- END ---`));
  assert.match(text, /^REFERENCE {2}O–[A-HJ-NP-Z2-9]{6}$/m);
  assert.match(text, /^RECEIVED {3}\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/m);
  assert.match(text, new RegExp(`^FROM {7}${NAME}$`, 'm'));
  assert.match(text, new RegExp(`^EMAIL {6}${EMAIL} {2}\\(private: never published\\)$`, 'm'));
  assert.match(text, /^FILE {7}photo\.jpg · image\/jpeg · 0\.00 MB · prepared in the browser from 8\.40 MB$/m);
  assert.ok(!text.includes(SIGNATURES.jpeg.toString('base64')), 'attachment data must not be in the text');
});

test('a submission without a file says so and has no attachments', async () => {
  await call(submission());
  assert.match(sent[0].message.text, /^FILE {7}none$/m);
  assert.equal(sent[0].message.attachments, undefined);
});

test('a file sent unchanged is described as chosen', () => {
  const message = buildMessage(validate(submission({ attachment: attachment(SIGNATURES.pdf, { name: 'scan.pdf' }) })).value, {
    reference: 'O–ABCDEF', receivedAt: new Date('2027-03-02T09:14:00Z'), from: 'mail@probnaya.work',
  });
  assert.match(message.text, /^FILE {7}scan\.pdf · application\/pdf · 0\.00 MB · as chosen$/m);
});

test('references use an unambiguous alphabet', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const reference = createReference();
    assert.match(reference, /^O–[A-HJ-NP-Z2-9]{6}$/);
    seen.add(reference);
  }
  assert.ok(seen.size > 490);
});

// ---------------------------------------------------------------------------
// Configuration and delivery failures
// ---------------------------------------------------------------------------

test('missing SMTP configuration is unavailable, not a crash, and sends nothing', async () => {
  delete process.env.SMTP_PASS;
  const res = await call(submission());
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'submission_unavailable');
  assert.equal(sent.length, 0);
  assert.deepEqual(JSON.parse(logs[0]), { event: 'observations.request', outcome: 'error', status: 503, code: 'configuration_unavailable' });
});

test('a delivery failure is unavailable and logs only a bounded error code', async () => {
  useMailer(async () => {
    const error = new Error(`Invalid login for ${EMAIL}: ${MATERIAL}`);
    error.code = 'EAUTH';
    throw error;
  });
  const res = await call(submission());
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'submission_unavailable');
  assert.deepEqual(JSON.parse(logs[0]), { event: 'observations.request', outcome: 'error', status: 503, code: 'delivery_failed', detail: 'EAUTH' });
  assertLogsClean(['Invalid login']);
});

test('an unusual error code is not copied into the log', async () => {
  useMailer(async () => { const e = new Error('x'); e.code = `bad code with ${EMAIL}`; throw e; });
  await call(submission());
  assert.equal(JSON.parse(logs[0]).detail, undefined);
  assertLogsClean();
});

test('refusals log one bounded line each and never any submitted data', async () => {
  await call(submission({ email: 'not an address', name: NAME }));
  await call(submission({ material: '' }));
  await call(submission({ attachment: attachment(Buffer.from([0x50, 0x4b, 3, 4, 5, 6, 7, 8]), { name: 'photo-secret.zip' }) }));
  assert.equal(logs.length, 3);
  for (const line of logs) {
    const record = JSON.parse(line);
    assert.deepEqual(Object.keys(record).sort(), ['code', 'event', 'outcome', 'status']);
  }
  assertLogsClean(['photo-secret']);
});

test('a successful submission logs nothing', async () => {
  await call(submission());
  assert.equal(logs.length, 0);
});

// ---------------------------------------------------------------------------
// Local development outbox
// ---------------------------------------------------------------------------

test('the local outbox prints the message instead of sending it, without SMTP configuration', async () => {
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.SMTP_FROM;
  process.env.OBSERVATIONS_DEV_OUTBOX = '1';
  const res = await call(submission({ attachment: attachment(SIGNATURES.png, { name: 'screen.png' }) }));
  assert.equal(res.statusCode, 200);
  assert.equal(sent.length, 0);
  assert.match(outbox, /\[local observations outbox\] OBSERVATION \/ RECEIVED O–/);
  assert.match(outbox, /attachment screen\.png · image\/png · 12 bytes/);
  assert.ok(!outbox.includes(SIGNATURES.png.toString('base64')));
});

test('the local outbox is refused on Vercel', async () => {
  process.env.OBSERVATIONS_DEV_OUTBOX = '1';
  process.env.VERCEL = '1';
  delete process.env.SMTP_PASS;
  const res = await call(submission());
  assert.equal(res.statusCode, 503);
  assert.equal(outbox, '');
  assert.equal(sent.length, 0);
});

// ---------------------------------------------------------------------------
// The real message, as the installed nodemailer builds it (no network)
// ---------------------------------------------------------------------------

test('installed nodemailer builds a plain-text message with Reply-To and the attachment', async () => {
  const nodemailer = require('nodemailer');
  const value = validate(submission({
    material: 'Line one.\n\nLine two — “quoted”.',
    attachment: attachment(SIGNATURES.png, { name: 'screen shot.png', prepared: true, originalBytes: 5_040_000 }),
  })).value;
  const message = buildMessage(value, { reference: 'O–ABCDEF', receivedAt: new Date('2027-03-02T09:14:00Z'), from: 'mail@probnaya.work' });

  const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  const info = await transporter.sendMail(message);
  const raw = info.message.toString('utf8');

  assert.deepEqual(info.envelope.to, ['mail@probnaya.work']);
  assert.equal(info.envelope.from, 'mail@probnaya.work');
  assert.match(raw, /^From: mail@probnaya\.work$/m);
  assert.match(raw, /^To: mail@probnaya\.work$/m);
  assert.match(raw, new RegExp(`^Reply-To: ${EMAIL.replace('.', '\\.')}$`, 'm'));
  assert.match(raw, /^Subject: =\?UTF-8\?|^Subject: OBSERVATION \/ RECEIVED O/m);
  assert.match(raw, /Content-Type: text\/plain; charset=utf-8/);
  assert.ok(!/Content-Type: text\/html/.test(raw), 'no HTML part');
  assert.match(raw, /Content-Type: image\/png; name="screen shot\.png"/);
  assert.match(raw, /Content-Disposition: attachment; filename="screen shot\.png"/);
  assert.ok(raw.includes(SIGNATURES.png.toString('base64')), 'attachment bytes are carried as base64');
  assert.ok(!/^(Cc|Bcc):/m.test(raw));
});
