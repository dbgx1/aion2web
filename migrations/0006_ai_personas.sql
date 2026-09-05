CREATE TABLE ai_personas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_key TEXT NOT NULL UNIQUE,
  owner_username TEXT NOT NULL,
  name TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  style_prompt TEXT NOT NULL,
  goal_prompt TEXT NOT NULL,
  forbidden_prompt TEXT NOT NULL,
  example_prompt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_ai_personas_updated
ON ai_personas(updated_at DESC);
