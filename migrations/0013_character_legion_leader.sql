ALTER TABLE game_characters ADD COLUMN is_legion_leader INTEGER NOT NULL DEFAULT 0
  CHECK (is_legion_leader IN (0, 1));
