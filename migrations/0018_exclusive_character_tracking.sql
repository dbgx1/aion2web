-- Preserve full duplicate records before retiring later claims. No notes deleted.
CREATE TABLE character_tracking_conflict_archive AS
SELECT t.*, CAST(strftime('%s', 'now') AS INTEGER) * 1000 AS resolved_at
FROM character_tracking t
WHERE t.active = 1 AND EXISTS (
  SELECT 1 FROM character_tracking first
  WHERE first.character_db_id = t.character_db_id AND first.active = 1
    AND (first.created_at < t.created_at OR
      (first.created_at = t.created_at AND first.owner_user_key < t.owner_user_key))
);
UPDATE character_tracking SET active = 0
WHERE EXISTS (SELECT 1 FROM character_tracking_conflict_archive backup
  WHERE backup.owner_user_key = character_tracking.owner_user_key
    AND backup.character_db_id = character_tracking.character_db_id);
CREATE UNIQUE INDEX idx_tracking_one_active_owner
ON character_tracking(character_db_id) WHERE active = 1;
