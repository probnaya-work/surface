BEGIN;

-- Suspension ends every outstanding establishment authority as well as sessions.
-- An emailed establishment link must not become usable again when a suspended,
-- still-pending holder is later reactivated; a new grant is issued deliberately.
CREATE OR REPLACE FUNCTION access_freeze_holder_authority() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.condition = 'active' AND NEW.condition <> 'active' THEN
    UPDATE access_sessions
      SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
      WHERE holder_id = NEW.id AND revoked_at IS NULL;
    UPDATE access_recovery_sessions
      SET consumed_at = COALESCE(consumed_at, CURRENT_TIMESTAMP)
      WHERE holder_id = NEW.id AND consumed_at IS NULL;
  END IF;
  IF NEW.condition = 'suspended' THEN
    -- `created_at` is never later than any clock that later reads the grant, so
    -- the grant is unusable regardless of application/database clock skew.
    UPDATE access_enrollment_grants
      SET expires_at = LEAST(expires_at, created_at)
      WHERE holder_id = NEW.id AND consumed_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- The trigger itself is unchanged from 002 and still fires on every condition change.
DROP TRIGGER IF EXISTS access_holders_freeze_authority ON access_holders;
CREATE TRIGGER access_holders_freeze_authority
AFTER UPDATE OF condition ON access_holders
FOR EACH ROW
WHEN (OLD.condition IS DISTINCT FROM NEW.condition)
EXECUTE FUNCTION access_freeze_holder_authority();

-- Bring grants of holders already suspended into the same invariant.
UPDATE access_enrollment_grants g
SET expires_at = LEAST(g.expires_at, g.created_at)
WHERE g.consumed_at IS NULL
  AND g.expires_at > g.created_at
  AND EXISTS (
    SELECT 1 FROM access_holders h
    WHERE h.id = g.holder_id AND h.condition = 'suspended'
  );

COMMIT;

-- Rollback restores the 002 function body (re-run 002_holder_authority.sql). It
-- cannot and must not revive grants expired while this migration was in place.
