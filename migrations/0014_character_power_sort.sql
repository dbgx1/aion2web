CREATE INDEX IF NOT EXISTS idx_characters_power_desc
  ON game_characters ((combat_power IS NULL), combat_power DESC, id);
CREATE INDEX IF NOT EXISTS idx_characters_power_asc
  ON game_characters ((combat_power IS NULL), combat_power ASC, id);
