BEGIN;

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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS access_holders_freeze_authority ON access_holders;
CREATE TRIGGER access_holders_freeze_authority
AFTER UPDATE OF condition ON access_holders
FOR EACH ROW
WHEN (OLD.condition IS DISTINCT FROM NEW.condition)
EXECUTE FUNCTION access_freeze_holder_authority();

-- Bring any authority created by an earlier draft into the same invariant.
UPDATE access_sessions s
SET revoked_at = COALESCE(s.revoked_at, CURRENT_TIMESTAMP)
WHERE s.revoked_at IS NULL
  AND EXISTS (
    SELECT 1 FROM access_holders h
    WHERE h.id = s.holder_id AND h.condition <> 'active'
  );

UPDATE access_recovery_sessions rs
SET consumed_at = COALESCE(rs.consumed_at, CURRENT_TIMESTAMP)
WHERE rs.consumed_at IS NULL
  AND EXISTS (
    SELECT 1 FROM access_holders h
    WHERE h.id = rs.holder_id AND h.condition <> 'active'
  );

COMMIT;

-- Rollback removes future automatic invalidation only. It cannot and must not
-- resurrect sessions invalidated when this migration was applied.
-- DROP TRIGGER access_holders_freeze_authority ON access_holders;
-- DROP FUNCTION access_freeze_holder_authority();
