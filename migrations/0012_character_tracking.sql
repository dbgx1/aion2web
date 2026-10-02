CREATE TABLE character_tracking (
  owner_user_key TEXT NOT NULL,
  character_db_id INTEGER NOT NULL REFERENCES game_characters(id) ON DELETE CASCADE,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('high','medium','low')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','contacting','waiting','closed')),
  notes TEXT NOT NULL DEFAULT '',
  next_follow_up INTEGER,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(owner_user_key, character_db_id)
);
