export const RP_NAME = 'PROBNAYA';
export const PRODUCTION_RP_ID = 'access.probnaya.work';
export const PRODUCTION_ORIGIN = 'https://access.probnaya.work';
// The one public origin that may read the holder relation with credentials.
export const PRODUCTION_PUBLIC_ORIGIN = 'https://probnaya.work';

export const CEREMONY_TTL_MS = 5 * 60 * 1000;
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
export const SESSION_ROTATE_MS = 15 * 60 * 1000;
export const RECENT_AUTH_MS = 5 * 60 * 1000;
export const RECOVERY_SESSION_MS = 10 * 60 * 1000;
// An establishment link travels by email and is opened when the person next
// reads mail. It can only issue the first key of an empty pending holder.
export const ENROLLMENT_GRANT_MS = 7 * 24 * 60 * 60 * 1000;
// The fragment that carries an establishment grant in a link. Fragments are
// never sent to the server, so the grant stays out of request logs and Referer.
export const ESTABLISHMENT_FRAGMENT = 'establish';

// Access requests go to one fixed PROBNAYA mailbox and nowhere else.
export const REQUEST_RECIPIENT = 'mail@probnaya.work';
export const REQUEST_SMTP_HOST = 'smtp.gmail.com';
export const REQUEST_SMTP_PORT = 465;
export const REQUEST_NETWORK_LIMIT = Object.freeze({ limit: 3, windowMs: 10 * 60 * 1000, blockMs: 30 * 60 * 1000 });
// Protects the sending account from provider limits; one fixed bucket for all networks.
export const REQUEST_DAILY_LIMIT = Object.freeze({ limit: 100, windowMs: 24 * 60 * 60 * 1000, blockMs: 60 * 60 * 1000 });
export const REQUEST_UNAVAILABLE = 'REQUESTS CANNOT BE SENT FROM HERE AT THE MOMENT. WRITE TO MAIL@PROBNAYA.WORK.';
export const BODY_LIMIT_BYTES = 96 * 1024;

export const SESSION_COOKIE_PRODUCTION = '__Host-probnaya_session';
export const SESSION_COOKIE_DEVELOPMENT = 'probnaya_dev_session';
export const PREAUTH_COOKIE_PRODUCTION = '__Host-probnaya_preauth';
export const PREAUTH_COOKIE_DEVELOPMENT = 'probnaya_dev_preauth';
export const RECOVERY_COOKIE_PRODUCTION = '__Host-probnaya_recovery';
export const RECOVERY_COOKIE_DEVELOPMENT = 'probnaya_dev_recovery';

export const GENERIC_AUTH_ERROR = 'ACCESS COULD NOT BE VERIFIED';
export const GENERIC_RECOVERY_ERROR = 'RECOVERY COULD NOT BE VERIFIED';

export const TRANSPORTS = new Set([
  'ble',
  'cable',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
]);
