ALTER TABLE game_characters ADD COLUMN combat_power INTEGER
  CHECK (combat_power IS NULL OR (combat_power >= 0 AND combat_power <= 9007199254740991));
