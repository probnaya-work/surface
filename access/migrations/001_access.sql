BEGIN;

CREATE TABLE access_holders (
  id uuid PRIMARY KEY,
  public_id text NOT NULL UNIQUE CHECK (public_id ~ '^PROB–H–[0-9A-Z][0-9A-Z-]{1,30}$'),
  webauthn_user_id text NOT NULL UNIQUE,
  condition text NOT NULL CHECK (condition IN ('pending', 'active', 'suspended')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE access_credentials (
  id uuid PRIMARY KEY,
  management_ref text NOT NULL UNIQUE,
  holder_id uuid NOT NULL REFERENCES access_holders(id),
  credential_id text NOT NULL UNIQUE,
  public_key bytea NOT NULL,
  signature_counter bigint NOT NULL CHECK (signature_counter >= 0),
  transports text[] NOT NULL DEFAULT '{}',
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 48),
  kind text NOT NULL CHECK (kind IN ('PASSKEY', 'SECURITY KEY')),
  device_type text NOT NULL,
  backed_up boolean NOT NULL,
  issued_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  counter_anomaly_at timestamptz
);
CREATE INDEX access_credentials_holder_active_idx ON access_credentials(holder_id) WHERE revoked_at IS NULL;

CREATE TABLE access_ceremonies (
  id text PRIMARY KEY,
  purpose text NOT NULL CHECK (purpose IN ('first-registration', 'authentication', 'verify-presence', 'add-key', 'recovery-registration')),
  binding_hash text NOT NULL,
  holder_id uuid REFERENCES access_holders(id),
  reference_id uuid,
  challenge text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX access_ceremonies_expiry_idx ON access_ceremonies(expires_at);

CREATE TABLE access_sessions (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  csrf_hash text NOT NULL,
  holder_id uuid NOT NULL REFERENCES access_holders(id),
  credential_id text NOT NULL REFERENCES access_credentials(credential_id),
  issued_at timestamptz NOT NULL,
  last_active_at timestamptz NOT NULL,
  renew_after timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  last_verified_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX access_sessions_holder_active_idx ON access_sessions(holder_id) WHERE revoked_at IS NULL;
CREATE INDEX access_sessions_expiry_idx ON access_sessions(absolute_expires_at);

CREATE TABLE access_enrollment_grants (
  id uuid PRIMARY KEY,
  holder_id uuid NOT NULL REFERENCES access_holders(id),
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  operator_note text
);

CREATE TABLE access_recovery_sets (
  id uuid PRIMARY KEY,
  holder_id uuid NOT NULL REFERENCES access_holders(id),
  issued_at timestamptz NOT NULL,
  replaced_at timestamptz
);
CREATE UNIQUE INDEX access_recovery_sets_one_active_idx ON access_recovery_sets(holder_id) WHERE replaced_at IS NULL;

CREATE TABLE access_recovery_codes (
  set_id uuid NOT NULL REFERENCES access_recovery_sets(id),
  holder_id uuid NOT NULL REFERENCES access_holders(id),
  code_hash text PRIMARY KEY,
  used_at timestamptz
);
CREATE INDEX access_recovery_codes_set_idx ON access_recovery_codes(set_id);

CREATE TABLE access_recovery_sessions (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  csrf_hash text NOT NULL,
  holder_id uuid NOT NULL REFERENCES access_holders(id),
  set_id uuid NOT NULL REFERENCES access_recovery_sets(id),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE TABLE access_rate_limits (
  bucket_key text PRIMARY KEY,
  count integer NOT NULL,
  window_started_at timestamptz NOT NULL,
  blocked_until timestamptz NOT NULL
);
CREATE INDEX access_rate_limits_expiry_idx ON access_rate_limits(blocked_until);

CREATE TABLE access_audit_events (
  id uuid PRIMARY KEY,
  holder_id uuid REFERENCES access_holders(id),
  event_type text NOT NULL,
  outcome text NOT NULL,
  credential_ref text,
  network_hash text,
  occurred_at timestamptz NOT NULL
);
CREATE INDEX access_audit_events_holder_time_idx ON access_audit_events(holder_id, occurred_at DESC);

COMMIT;

-- Rollback, before production data exists:
-- DROP TABLE access_audit_events, access_rate_limits, access_recovery_sessions,
--   access_recovery_codes, access_recovery_sets, access_enrollment_grants,
--   access_sessions, access_ceremonies, access_credentials, access_holders;
