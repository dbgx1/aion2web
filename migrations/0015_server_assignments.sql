CREATE TABLE server_assignments (
  server_id TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES admin_users(id),
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_server_assignments_user ON server_assignments(user_id);
CREATE TABLE server_assignment_audit (
  id INTEGER PRIMARY KEY,
  server_id TEXT NOT NULL,
  previous_user_id INTEGER,
  user_id INTEGER,
  version INTEGER NOT NULL,
  operator_user_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TRIGGER server_assignment_insert AFTER INSERT ON server_assignments BEGIN
  INSERT INTO server_assignment_audit(server_id, previous_user_id, user_id, version, operator_user_key, created_at)
  VALUES(NEW.server_id, NULL, NEW.user_id, NEW.version, NEW.updated_by, NEW.updated_at);
END;
CREATE TRIGGER server_assignment_update AFTER UPDATE ON server_assignments BEGIN
  INSERT INTO server_assignment_audit(server_id, previous_user_id, user_id, version, operator_user_key, created_at)
  VALUES(NEW.server_id, OLD.user_id, NEW.user_id, NEW.version, NEW.updated_by, NEW.updated_at);
END;
