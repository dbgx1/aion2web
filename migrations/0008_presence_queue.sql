CREATE TABLE IF NOT EXISTS character_presence (
  server_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  character_name TEXT NOT NULL,
  is_online INTEGER NOT NULL DEFAULT 0,
  checked_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  source_id TEXT,
  PRIMARY KEY (server_id, character_id)
);

CREATE INDEX IF NOT EXISTS idx_character_presence_server_online
ON character_presence(server_id, is_online, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_character_presence_updated
ON character_presence(updated_at DESC);

CREATE TABLE IF NOT EXISTS presence_jobs (
  id TEXT PRIMARY KEY,
  created_by_user_key TEXT NOT NULL,
  created_by_username TEXT NOT NULL,
  server_id TEXT,
  legion_name TEXT,
  without_legion INTEGER NOT NULL DEFAULT 0,
  search TEXT,
  filter_json TEXT NOT NULL,
  total_count INTEGER NOT NULL DEFAULT 0,
  queued_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  done_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_presence_jobs_created
ON presence_jobs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_presence_jobs_user_created
ON presence_jobs(created_by_user_key, created_at DESC);

CREATE TABLE IF NOT EXISTS presence_tasks (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  character_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  leased_by TEXT,
  leased_until INTEGER,
  result_online INTEGER,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (job_id) REFERENCES presence_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_presence_tasks_claim
ON presence_tasks(status, leased_until, priority DESC, created_at);

CREATE INDEX IF NOT EXISTS idx_presence_tasks_job_status
ON presence_tasks(job_id, status);

CREATE INDEX IF NOT EXISTS idx_presence_tasks_character
ON presence_tasks(server_id, character_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_presence_tasks_active_character
ON presence_tasks(server_id, character_id)
WHERE status IN ('pending', 'claimed');
