import { randomBytes } from 'node:crypto';
import { createHandler } from '../api/access.js';
import { createRelationHandler } from '../api/relation.js';
import { loadConfig } from '../lib/config.js';
import { AccessService } from '../lib/service.js';
import { createWebAuthn } from '../lib/webauthn.js';

export const PRODUCTION_ENV = Object.freeze({
  ACCESS_ENV: 'production',
  SESSION_HASH_KEY: randomBytes(32).toString('base64'),
  RECOVERY_HASH_KEY: randomBytes(32).toString('base64'),
  NETWORK_HASH_KEY: randomBytes(32).toString('base64'),
  DATABASE_URL: 'postgres://access:unused@db.example.test:5432/access?sslmode=verify-full',
});

// Production constants from the real configuration loader, with the store and
// clock supplied by the test instead of the environment.
export function productionRuntime({ store, clock, notifier = null, env = {} }) {
  const config = loadConfig({ ...PRODUCTION_ENV, ...env });
  const service = new AccessService({ config, store, webauthn: createWebAuthn(config), notifier, clock });
  return { config, store, service };
}

// Records request messages instead of sending them. `fail` makes delivery throw.
export function recordingNotifier({ fail = false } = {}) {
  const sent = [];
  return {
    sent,
    async send(request) {
      if (fail) throw new Error('535 5.7.8 Username and Password not accepted for operator@example.test');
      sent.push(structuredClone(request));
    },
  };
}

export function captureLogger() {
  const lines = [];
  return { lines, warn: (line) => lines.push(line), error: (line) => lines.push(line) };
}

function parseSetCookie(value) {
  const [pair, ...attributes] = value.split(';').map((part) => part.trim());
  const index = pair.indexOf('=');
  return { name: pair.slice(0, index), value: pair.slice(index + 1), attributes };
}

// A same-origin browser: one cookie jar, exact Host and Origin, JSON bodies,
// and every Set-Cookie applied the way a browser would apply it.
export class Browser {
  constructor(runtime, { logger = captureLogger(), host, origin, network = '198.51.100.20' } = {}) {
    this.runtime = runtime;
    this.logger = logger;
    this.handler = createHandler({ runtime: async () => runtime, logger });
    this.relationHandler = createRelationHandler({ runtime: async () => runtime, logger });
    this.host = host ?? new URL(runtime.config.origin).host;
    this.origin = origin === undefined ? runtime.config.origin : origin;
    this.network = network;
    this.jar = new Map();
    this.setCookies = [];
    this.csrf = null;
  }

  cookieHeader() {
    return [...this.jar].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  async send({ method, body, headers = {}, handler = this.handler }) {
    const responseHeaders = new Map();
    const response = await new Promise((resolve) => {
      const res = {
        statusCode: 200,
        setHeader: (name, value) => responseHeaders.set(name.toLowerCase(), value),
        end: (text) => resolve({ status: res.statusCode, body: JSON.parse(text), headers: responseHeaders }),
      };
      const req = {
        method,
        body,
        socket: { remoteAddress: '127.0.0.1' },
        headers: {
          host: this.host,
          'x-forwarded-for': this.network,
          ...(this.jar.size ? { cookie: this.cookieHeader() } : {}),
          ...(method === 'POST' ? { 'content-type': 'application/json', ...(this.origin === null ? {} : { origin: this.origin }) } : {}),
          ...headers,
        },
      };
      handler(req, res);
    });
    const cookies = [].concat(responseHeaders.get('set-cookie') || []);
    for (const raw of cookies) {
      const parsed = parseSetCookie(raw);
      this.setCookies.push(parsed);
      if (parsed.attributes.includes('Max-Age=0')) this.jar.delete(parsed.name);
      else this.jar.set(parsed.name, parsed.value);
    }
    return response;
  }

  async status(headers = { 'sec-fetch-site': 'same-origin' }) {
    const response = await this.send({ method: 'GET', headers });
    if (response.body.csrf) this.csrf = response.body.csrf;
    return response;
  }

  // A credentialed fetch from the public site to the relation read. The public
  // origin and same-site label are what a browser sends from probnaya.work.
  relation(headers = { origin: this.runtime.config.publicOrigin, 'sec-fetch-site': 'same-site' }, method = 'GET') {
    return this.send({ method, headers, handler: this.relationHandler });
  }

  async post(action, data = {}, { csrf = this.csrf, headers = {} } = {}) {
    const response = await this.send({
      method: 'POST',
      body: { action, data },
      headers: { ...(csrf ? { 'x-probnaya-csrf': csrf } : {}), ...headers },
    });
    if (response.body.csrf && action !== 'recovery-begin' && action !== 'recovery-resume') this.csrf = response.body.csrf;
    return response;
  }

  async expectOk(action, data, options) {
    const response = await this.post(action, data, options);
    if (response.status !== 200) throw new Error(`${action} returned ${response.status} ${response.body.error}`);
    return response.body;
  }

  // Authenticator overrides place the ceremony at the configured origin.
  webauthnOverrides() {
    return { origin: this.runtime.config.origin };
  }

  async enroll(authenticator, grant, label = 'PRIMARY PASSKEY') {
    const start = await this.expectOk('enrollment-options', { grant, label });
    const credential = await authenticator.registration(start.options, this.webauthnOverrides());
    return this.post('enrollment-verify', { ceremonyId: start.ceremonyId, label, credential });
  }

  async present(authenticator, userHandle) {
    const start = await this.expectOk('authentication-options');
    const credential = authenticator.authentication(start.options, userHandle, this.webauthnOverrides());
    return this.post('authentication-verify', { ceremonyId: start.ceremonyId, credential });
  }

  async verifyPresence(authenticator, userHandle) {
    const start = await this.expectOk('presence-options');
    const credential = authenticator.authentication(start.options, userHandle, this.webauthnOverrides());
    return this.post('presence-verify', { ceremonyId: start.ceremonyId, credential });
  }

  async addKey(authenticator, label = 'SECOND KEY') {
    const start = await this.expectOk('add-key-options', { label });
    const credential = await authenticator.registration(start.options, this.webauthnOverrides());
    return this.post('add-key-verify', { ceremonyId: start.ceremonyId, label, credential });
  }

  async recoveryRegistration(recoveryCsrf, authenticator, label = 'RECOVERY KEY') {
    const start = await this.expectOk('recovery-registration-options', { label }, { csrf: recoveryCsrf });
    const credential = await authenticator.registration(start.options, this.webauthnOverrides());
    return { start, credential, verify: () => this.post('recovery-registration-verify', { ceremonyId: start.ceremonyId, label, credential }, { csrf: recoveryCsrf }) };
  }
}
