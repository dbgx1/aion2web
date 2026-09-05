ALTER TABLE admin_users ADD COLUMN role TEXT NOT NULL DEFAULT 'agent'
  CHECK (role IN ('admin', 'agent'));

ALTER TABLE admin_users ADD COLUMN display_name TEXT;

ALTER TABLE admin_users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'disabled'));

ALTER TABLE chat_messages ADD COLUMN operator_user_key TEXT;

ALTER TABLE chat_messages ADD COLUMN operator_username TEXT;

CREATE TABLE client_locks (
  agent_id TEXT PRIMARY KEY,
  user_key TEXT NOT NULL,
  username TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_client_locks_expires
ON client_locks(expires_at);
