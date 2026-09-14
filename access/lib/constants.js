export const RP_NAME = 'PROBNAYA';
export const PRODUCTION_RP_ID = 'access.probnaya.work';
export const PRODUCTION_ORIGIN = 'https://access.probnaya.work';

export const CEREMONY_TTL_MS = 5 * 60 * 1000;
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
export const SESSION_ROTATE_MS = 15 * 60 * 1000;
export const RECENT_AUTH_MS = 5 * 60 * 1000;
export const RECOVERY_SESSION_MS = 10 * 60 * 1000;
export const ENROLLMENT_GRANT_MS = 24 * 60 * 60 * 1000;
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
