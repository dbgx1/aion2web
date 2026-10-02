-- Keep existing ownership/revisions and expand each assignment to a member list.
ALTER TABLE server_assignments ADD COLUMN user_ids TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(user_ids) AND json_type(user_ids) = 'array');
UPDATE server_assignments SET user_ids = json_array(user_id) WHERE user_id IS NOT NULL;

CREATE TABLE server_assignment_membership_audit (
  id INTEGER PRIMARY KEY,
  server_id TEXT NOT NULL,
  previous_user_ids TEXT NOT NULL,
  user_ids TEXT NOT NULL,
  version INTEGER NOT NULL,
  operator_user_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TRIGGER shared_assignment_insert AFTER INSERT ON server_assignments BEGIN
  INSERT INTO server_assignment_membership_audit(server_id, previous_user_ids, user_ids, version, operator_user_key, created_at)
  VALUES(NEW.server_id, '[]', NEW.user_ids, NEW.version, NEW.updated_by, NEW.updated_at);
END;
CREATE TRIGGER shared_assignment_update AFTER UPDATE OF user_ids ON server_assignments
WHEN NEW.user_ids != OLD.user_ids BEGIN
  INSERT INTO server_assignment_membership_audit(server_id, previous_user_ids, user_ids, version, operator_user_key, created_at)
  VALUES(NEW.server_id, OLD.user_ids, NEW.user_ids, NEW.version, NEW.updated_by, NEW.updated_at);
END;

-- During rollout, legacy worker writes still update the member list correctly.
CREATE TRIGGER legacy_assignment_insert AFTER INSERT ON server_assignments
WHEN NEW.user_id IS NOT NULL AND NEW.user_ids = '[]' BEGIN
  UPDATE server_assignments SET user_ids = json_array(NEW.user_id) WHERE server_id = NEW.server_id;
END;
CREATE TRIGGER legacy_assignment_update AFTER UPDATE OF user_id ON server_assignments
WHEN NEW.user_id IS NOT OLD.user_id AND NEW.user_ids = OLD.user_ids BEGIN
  UPDATE server_assignments SET user_ids = CASE WHEN NEW.user_id IS NULL THEN '[]' ELSE json_array(NEW.user_id) END
  WHERE server_id = NEW.server_id;
END;
