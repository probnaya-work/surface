export class AccessError extends Error {
  constructor(status, code, publicMessage, options = {}) {
    super(code, options);
    this.name = 'AccessError';
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
    this.retryAfter = options.retryAfter;
  }
}

export function badRequest(code = 'invalid_request', message = 'REQUEST COULD NOT BE PROCESSED') {
  return new AccessError(400, code, message);
}

export function unauthorized(message = 'AUTHENTICATION REQUIRED') {
  return new AccessError(401, 'unauthorized', message);
}

export function forbidden(message = 'REQUEST NOT AUTHORIZED') {
  return new AccessError(403, 'forbidden', message);
}

export function rateLimited(retryAfter = 60) {
  return new AccessError(429, 'rate_limited', 'TRY AGAIN LATER', { retryAfter });
}
