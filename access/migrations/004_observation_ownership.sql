BEGIN;

-- Private ownership of published Observations (docs/observation-ownership.md).
-- The only value shared with the public, Git-backed record is the three-digit
-- archival number. Addresses are never stored: `contact_lookup` is a keyed HMAC
-- computed by an operator command (lib/contact.js). Nothing here is ever served
-- publicly or read by the static site build.

-- The address an establishment link was sent to. It becomes a verified contact of
-- the holder only when that grant is consumed, because only the person who can
-- read that mail can open the link.
ALTER TABLE access_enrollment_grants ADD COLUMN IF NOT EXISTS contact_lookup text
  CHECK (contact_lookup ~ '^hmac-sha256:contact-v1:[A-Za-z0-9_-]{43}$');
CREATE INDEX IF NOT EXISTS access_enrollment_grants_contact_idx
  ON access_enrollment_grants(contact_lookup) WHERE contact_lookup IS NOT NULL AND consumed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS access_observation_ownership (
  observation_number text PRIMARY KEY CHECK (observation_number ~ '^[0-9]{3}$' AND observation_number <> '000'),
  -- The address the Observation was sent from, confirmed by correspondence.
  -- Null only for an Observation offered directly to one holder by an operator.
  contact_lookup text CHECK (contact_lookup ~ '^hmac-sha256:contact-v1:[A-Za-z0-9_-]{43}$'),
  -- Public facts copied from the published record so the holder can recognise it.
  title text CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 300),
  published_on date NOT NULL,
  status text NOT NULL CHECK (status IN ('awaiting_account', 'offered', 'claimed', 'detached')),
  -- The owner once claimed; kept after detachment as the record of what was undone.
  holder_id uuid REFERENCES access_holders(id),
  -- An operator's manually verified offer to one holder, whatever address matched.
  offered_holder_id uuid REFERENCES access_holders(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  offered_at timestamptz,
  claimed_at timestamptz,
  detached_at timestamptz,
  CHECK (contact_lookup IS NOT NULL OR offered_holder_id IS NOT NULL OR status = 'detached'),
  CHECK ((status = 'claimed') = (holder_id IS NOT NULL AND claimed_at IS NOT NULL AND detached_at IS NULL)
         OR status = 'detached'),
  CHECK (status <> 'detached' OR detached_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS access_observation_ownership_contact_idx
  ON access_observation_ownership(contact_lookup) WHERE status IN ('awaiting_account', 'offered');
CREATE INDEX IF NOT EXISTS access_observation_ownership_holder_idx
  ON access_observation_ownership(holder_id) WHERE status = 'claimed';

-- "Not mine": the Observation is never offered to that holder again. It claims
-- nothing and changes nothing else.
CREATE TABLE IF NOT EXISTS access_observation_declines (
  observation_number text NOT NULL REFERENCES access_observation_ownership(observation_number),
  holder_id uuid NOT NULL REFERENCES access_holders(id),
  declined_at timestamptz NOT NULL,
  PRIMARY KEY (observation_number, holder_id)
);

-- Least privilege, when the production roles exist (local test databases have none).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'access_runtime') THEN
    GRANT SELECT ON access_observation_ownership, access_observation_declines TO access_runtime;
    GRANT UPDATE (status, holder_id, offered_at, claimed_at, updated_at) ON access_observation_ownership TO access_runtime;
    GRANT INSERT ON access_observation_declines TO access_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'access_operator') THEN
    GRANT SELECT, INSERT ON access_observation_ownership TO access_operator;
    GRANT UPDATE (contact_lookup, title, published_on, status, holder_id, offered_holder_id,
                  updated_at, offered_at, claimed_at, detached_at) ON access_observation_ownership TO access_operator;
    GRANT SELECT, DELETE ON access_observation_declines TO access_operator;
  END IF;
END;
$$;

COMMIT;

-- Rollback, before any ownership exists:
-- DROP TABLE access_observation_declines, access_observation_ownership;
-- DROP INDEX access_enrollment_grants_contact_idx;
-- ALTER TABLE access_enrollment_grants DROP COLUMN contact_lookup;
