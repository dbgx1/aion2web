-- One durable ownership slot per server and guild name. Released rows retain revision.
CREATE TABLE guild_tracking (
  server_id TEXT NOT NULL,
  legion_name TEXT NOT NULL CHECK(length(trim(legion_name)) > 0),
  owner_user_key TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (server_id, legion_name)
);
CREATE INDEX idx_guild_tracking_owner ON guild_tracking(owner_user_key, server_id);
CREATE TABLE guild_tracking_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT NOT NULL,
  legion_name TEXT NOT NULL,
  previous_owner TEXT,
  next_owner TEXT,
  actor TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TRIGGER guild_tracking_created AFTER INSERT ON guild_tracking BEGIN
  INSERT INTO guild_tracking_events(server_id,legion_name,previous_owner,next_owner,actor,version,created_at)
  VALUES(NEW.server_id,NEW.legion_name,NULL,NEW.owner_user_key,NEW.updated_by,NEW.version,NEW.updated_at);
END;
CREATE TRIGGER guild_tracking_changed AFTER UPDATE ON guild_tracking
WHEN OLD.owner_user_key IS NOT NEW.owner_user_key BEGIN
  INSERT INTO guild_tracking_events(server_id,legion_name,previous_owner,next_owner,actor,version,created_at)
  VALUES(NEW.server_id,NEW.legion_name,OLD.owner_user_key,NEW.owner_user_key,NEW.updated_by,NEW.version,NEW.updated_at);
END;
