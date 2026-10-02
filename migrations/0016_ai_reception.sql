CREATE TABLE IF NOT EXISTS reception_settings (
  owner_user_key TEXT PRIMARY KEY, settings_json TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reception_profiles (
  server_id TEXT NOT NULL, character_id TEXT NOT NULL, character_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ai' CHECK(status IN ('ai','waiting','human','closed')),
  version INTEGER NOT NULL DEFAULT 0, memory TEXT NOT NULL DEFAULT '',
  discord_declined INTEGER NOT NULL DEFAULT 0, paid_declined INTEGER NOT NULL DEFAULT 0,
  discord_sent INTEGER NOT NULL DEFAULT 0, sent_guides TEXT NOT NULL DEFAULT '[]',
  decision_json TEXT, assigned_to TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL,
  PRIMARY KEY(server_id, character_id)
);
CREATE INDEX IF NOT EXISTS reception_queue ON reception_profiles(status, updated_at DESC);
CREATE TABLE IF NOT EXISTS reception_turns (
  id TEXT PRIMARY KEY, owner_user_key TEXT NOT NULL, server_id TEXT NOT NULL, character_id TEXT NOT NULL,
  message_id TEXT NOT NULL, profile_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('generating','ready','sending','sent','skipped','uncertain','failed')),
  decision_json TEXT, issues_json TEXT NOT NULL DEFAULT '[]', history_json TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(server_id, character_id, message_id)
);
CREATE INDEX IF NOT EXISTS reception_turn_history ON reception_turns(server_id, character_id, created_at DESC);
