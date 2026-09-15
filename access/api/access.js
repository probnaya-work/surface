import { AccessError, badRequest } from '../lib/errors.js';
import {
  clientNetwork,
  cookie,
  expireCookie,
  logOutcome,
  parseCookies,
  readJSON,
  requireExactOrigin,
  requireSameOriginFetch,
  sendError,
  sendJSON,
} from '../lib/http.js';
import { getRuntime } from '../lib/runtime.js';
import { exactObject } from '../lib/validation.js';

const ACTIONS = new Set([
  'request-access',
  'authentication-options',
  'authentication-verify',
  'enrollment-options',
  'enrollment-verify',
  'presence-options',
  'presence-verify',
  'add-key-options',
  'add-key-verify',
  'revoke-key',
  'replace-recovery-codes',
  'recovery-begin',
  'recovery-resume',
  'recovery-registration-options',
  'recovery-registration-verify',
  'logout',
]);

function setCookies(res, values) {
  res.setHeader('Set-Cookie', values);
}

export function requireHost(req, config) {
  const expected = new URL(config.origin).host;
  if (req.headers?.host !== expected) throw new AccessError(421, 'invalid_host', 'REQUEST NOT AUTHORIZED');
}

export function createHandler({ runtime = getRuntime, logger = console } = {}) {
  return async function handler(req, res) {
    let action = null;
    try {
      const { config, service } = await runtime();
      requireHost(req, config);
      const cookies = parseCookies(req.headers?.cookie);
      const network = clientNetwork(req, { production: config.production });

      if (req.method === 'GET') {
        requireSameOriginFetch(req);
        const result = await service.status(cookies[config.cookies.session]);
        if (result.rotated) setCookies(res, [cookie(config.cookies.session, result.token, { production: config.production })]);
        return sendJSON(res, 200, {
          ok: true,
          holder: result.holder,
          lastVerifiedAt: result.lastVerifiedAt,
          record: result.record,
          csrf: result.csrf,
        });
      }

      if (req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        throw new AccessError(405, 'method_not_allowed', 'METHOD NOT ALLOWED');
      }

      requireExactOrigin(req, config.origin);
      const body = await readJSON(req);
      exactObject(body, ['action', 'data']);
      if (typeof body.action !== 'string' || !ACTIONS.has(body.action)) throw badRequest();
      action = body.action;
      const csrf = req.headers?.['x-probnaya-csrf'];
      const sessionToken = cookies[config.cookies.session];
      const recoveryToken = cookies[config.cookies.recovery];
      let result;

      switch (action) {
        case 'authentication-options': {
          exactObject(body.data, [], []);
          result = await service.authenticationOptions({ preauthToken: cookies[config.cookies.preauth], network });
          setCookies(res, [cookie(config.cookies.preauth, result.binding.token, { production: config.production, maxAge: 300 })]);
          return sendJSON(res, 200, { ok: true, ceremonyId: result.ceremonyId, options: result.options });
        }
        case 'authentication-verify': {
          result = await service.authenticationVerify({ preauthToken: cookies[config.cookies.preauth], payload: body.data, network });
          setCookies(res, [
            cookie(config.cookies.session, result.token, { production: config.production }),
            expireCookie(config.cookies.preauth, config.production),
          ]);
          return sendJSON(res, 200, { ok: true, authenticated: true, holder: result.holder, csrf: result.csrf });
        }
        case 'request-access': {
          await service.requestAccess({ payload: body.data, network });
          return sendJSON(res, 200, { ok: true, received: true });
        }
        case 'enrollment-options': {
          result = await service.enrollmentOptions({ preauthToken: cookies[config.cookies.preauth], payload: body.data, network });
          setCookies(res, [cookie(config.cookies.preauth, result.binding.token, { production: config.production, maxAge: 300 })]);
          return sendJSON(res, 200, { ok: true, ceremonyId: result.ceremonyId, options: result.options });
        }
        case 'enrollment-verify': {
          result = await service.enrollmentVerify({ preauthToken: cookies[config.cookies.preauth], payload: body.data, network });
          setCookies(res, [
            cookie(config.cookies.session, result.token, { production: config.production }),
            expireCookie(config.cookies.preauth, config.production),
          ]);
          return sendJSON(res, 200, { ok: true, authenticated: true, holder: result.holder, csrf: result.csrf, recoveryCodes: result.recoveryCodes });
        }
        case 'presence-options': {
          exactObject(body.data, [], []);
          result = await service.presenceOptions({ sessionToken, csrf, network });
          return sendJSON(res, 200, { ok: true, ...result });
        }
        case 'presence-verify': {
          result = await service.presenceVerify({ sessionToken, csrf, payload: body.data, network });
          setCookies(res, [cookie(config.cookies.session, result.token, { production: config.production })]);
          return sendJSON(res, 200, { ok: true, csrf: result.csrf, lastVerifiedAt: result.lastVerifiedAt });
        }
        case 'add-key-options': {
          result = await service.addKeyOptions({ sessionToken, csrf, payload: body.data, network });
          return sendJSON(res, 200, { ok: true, ...result });
        }
        case 'add-key-verify': {
          result = await service.addKeyVerify({ sessionToken, csrf, payload: body.data, network });
          setCookies(res, [cookie(config.cookies.session, result.token, { production: config.production })]);
          return sendJSON(res, 200, { ok: true, added: result.added, csrf: result.csrf });
        }
        case 'revoke-key': {
          result = await service.revokeKey({ sessionToken, csrf, payload: body.data, network });
          setCookies(res, [expireCookie(config.cookies.session, config.production)]);
          return sendJSON(res, 200, { ok: true, ...result });
        }
        case 'replace-recovery-codes': {
          exactObject(body.data, [], []);
          result = await service.replaceRecoveryCodes({ sessionToken, csrf, network });
          setCookies(res, [cookie(config.cookies.session, result.token, { production: config.production })]);
          return sendJSON(res, 200, { ok: true, recoveryCodes: result.recoveryCodes, csrf: result.csrf });
        }
        case 'recovery-begin': {
          result = await service.recoveryBegin({ payload: body.data, network });
          setCookies(res, [cookie(config.cookies.recovery, result.token, { production: config.production, maxAge: 600 })]);
          return sendJSON(res, 200, { ok: true, csrf: result.csrf, expiresAt: result.expiresAt });
        }
        case 'recovery-resume': {
          exactObject(body.data, [], []);
          result = await service.recoveryResume({ recoveryToken, network });
          return sendJSON(res, 200, { ok: true, csrf: result.csrf, expiresAt: result.expiresAt });
        }
        case 'recovery-registration-options': {
          result = await service.recoveryRegistrationOptions({ recoveryToken, csrf, payload: body.data, network });
          return sendJSON(res, 200, { ok: true, ...result });
        }
        case 'recovery-registration-verify': {
          result = await service.recoveryRegistrationVerify({ recoveryToken, csrf, payload: body.data, network });
          setCookies(res, [
            expireCookie(config.cookies.recovery, config.production),
            expireCookie(config.cookies.session, config.production),
          ]);
          return sendJSON(res, 200, { ok: true, recoveryCodes: result.recoveryCodes, requiresAuthentication: true });
        }
        case 'logout': {
          exactObject(body.data, [], []);
          result = await service.logout(sessionToken, csrf, network);
          setCookies(res, [expireCookie(config.cookies.session, config.production)]);
          return sendJSON(res, 200, { ok: true, ...result });
        }
        default:
          throw badRequest();
      }
    } catch (error) {
      // An anonymous status read is the normal signed-out page load, not an event.
      const anonymousStatus = req.method === 'GET' && error instanceof AccessError && error.status === 401;
      if (!anonymousStatus) logOutcome(logger, { method: req.method, action, error });
      return sendError(res, error);
    }
  };
}

export default createHandler();
