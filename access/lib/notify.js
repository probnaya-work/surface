import { REQUEST_RECIPIENT, REQUEST_SMTP_HOST, REQUEST_SMTP_PORT } from './constants.js';

// The operational message an access request becomes. It goes only to the
// PROBNAYA mailbox; the requester is never written to by the runtime. Reply-To
// lets the operator answer in the same thread. Nothing here is stored.
export function requestMessage({ from, email, reference, receivedAt }) {
  return {
    from,
    to: REQUEST_RECIPIENT,
    replyTo: { name: '', address: email },
    subject: `ACCESS / REQUEST ${reference}`,
    text: [
      'ACCESS REQUEST',
      '',
      `ADDRESS    ${email}`,
      `RECEIVED   ${new Date(receivedAt).toISOString()}`,
      `REFERENCE  ${reference}`,
      '',
      'After reviewing this request, from the trusted Access operator checkout:',
      `  npm run approve-request -- '${reference}'`,
      'Paste the saved access_operator URL at the masked prompt and confirm.',
      '',
      'Send the printed link to this address as a new message, not a reply.',
      'It is establishment authority: send it once and keep no other copy.',
    ].join('\n'),
  };
}

// `mailer` is injected by tests; production loads nodemailer only when a
// request is actually sent.
export function createRequestNotifier(requestMail, { mailer, output = process.stdout } = {}) {
  if (!requestMail) return null;
  if (requestMail.transport === 'console') {
    // Local development only (refused by production configuration).
    return Object.freeze({
      async send(request) {
        const message = requestMessage({ ...request, from: 'access@localhost' });
        output.write(`\n[local request outbox] ${message.subject}\n${message.text}\n\n`);
      },
    });
  }
  let transporter;
  return Object.freeze({
    async send(request) {
      if (!transporter) {
        const nodemailer = mailer || (await import('nodemailer')).default;
        transporter = nodemailer.createTransport({
          host: REQUEST_SMTP_HOST,
          port: REQUEST_SMTP_PORT,
          secure: true,
          auth: { user: requestMail.user, pass: requestMail.pass },
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 15_000,
          disableFileAccess: true,
          disableUrlAccess: true,
        });
      }
      await transporter.sendMail(requestMessage({ ...request, from: requestMail.from }));
    },
  });
}
