import { AccessError } from '../lib/errors.js';
import { cookie, logOutcome, parseCookies, sendError, sendJSON } from '../lib/http.js';
import { getRuntime } from '../lib/runtime.js';
import { requireHost } from './access.js';

// The holder relation, read by the public PROBNAYA origin with credentials.
//
// This is the only Access response a sibling origin may read. It is a GET with
// no body, exact Origin, and no CSRF token in the response, so it cannot drive
// or authorize any mutation. Session idle refresh and rotation are the same as
// the Access page's own status read: moving through public PROBNAYA keeps the
// session alive; it never extends the absolute lifetime.
export function createRelationHandler({ runtime = getRuntime, logger = console } = {}) {
  return async function relationHandler(req, res) {
    let cors = { Vary: 'Origin' };
    try {
      const { config, service } = await runtime();
      requireHost(req, config);
      const origin = req.headers?.origin;
      if (!config.publicOrigin || origin !== config.publicOrigin) throw new AccessError(403, 'invalid_origin', 'REQUEST NOT AUTHORIZED');
      const site = req.headers?.['sec-fetch-site'];
      if (site !== undefined && site !== 'same-site') throw new AccessError(403, 'cross_site_request', 'REQUEST NOT AUTHORIZED');
      cors = { ...cors, 'Access-Control-Allow-Origin': config.publicOrigin, 'Access-Control-Allow-Credentials': 'true' };
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        throw new AccessError(405, 'method_not_allowed', 'METHOD NOT ALLOWED');
      }
      const cookies = parseCookies(req.headers?.cookie);
      const result = await service.relation(cookies[config.cookies.session]);
      if (result.rotated) res.setHeader('Set-Cookie', [cookie(config.cookies.session, result.token, { production: config.production })]);
      return sendJSON(res, 200, { ok: true, relation: result.relation }, cors);
    } catch (error) {
      // An unrecognized visitor on public PROBNAYA is the normal case, not an event.
      const anonymous = req.method === 'GET' && error instanceof AccessError && error.status === 401;
      if (!anonymous) logOutcome(logger, { method: req.method, action: 'relation', error });
      return sendError(res, error, cors);
    }
  };
}

export default createRelationHandler();
