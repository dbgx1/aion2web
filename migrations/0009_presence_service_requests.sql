CREATE TABLE IF NOT EXISTS presence_requests (
  id TEXT PRIMARY KEY,
  user_key TEXT NOT NULL,
  service_id TEXT NOT NULL,
  characters_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  finished INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_presence_requests_active
ON presence_requests(service_id, finished, expires_at);
CREATE INDEX IF NOT EXISTS idx_presence_requests_owner
ON presence_requests(user_key, finished, expires_at);

CREATE TABLE IF NOT EXISTS presence_request_results (
  request_id TEXT NOT NULL REFERENCES presence_requests(id) ON DELETE CASCADE,
  server_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  PRIMARY KEY (request_id, server_id, character_id)
);
