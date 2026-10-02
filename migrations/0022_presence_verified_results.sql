-- Written only by the authenticated query dispatcher, before MQTT publication.
CREATE TABLE IF NOT EXISTS presence_verified_results (
  request_id TEXT NOT NULL REFERENCES presence_requests(id) ON DELETE CASCADE,
  server_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('online','offline','unknown')),
  checked_at INTEGER NOT NULL,
  PRIMARY KEY(request_id, server_id, character_id)
);
