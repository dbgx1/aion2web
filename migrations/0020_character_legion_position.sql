-- Only the old leader flag has an unambiguous position mapping.
ALTER TABLE game_characters ADD COLUMN legion_position INTEGER
  CHECK (legion_position IS NULL OR legion_position IN (0, 1, 2, 3));

UPDATE game_characters SET legion_position = 0 WHERE is_legion_leader = 1;
ALTER TABLE game_characters DROP COLUMN is_legion_leader;
