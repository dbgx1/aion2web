-- Nullable fields keep legacy clients and previously collected characters compatible.
ALTER TABLE game_characters ADD COLUMN equip_item_level INTEGER
  CHECK (equip_item_level IS NULL OR (typeof(equip_item_level) = 'integer' AND equip_item_level BETWEEN 0 AND 2147483647));
ALTER TABLE game_characters ADD COLUMN gender INTEGER
  CHECK (gender IS NULL OR (typeof(gender) = 'integer' AND gender IN (0, 1, 2)));
