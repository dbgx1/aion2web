PRAGMA foreign_keys = ON;

CREATE TABLE game_characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_name TEXT NOT NULL,
  character_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  server_name TEXT,
  legion_name TEXT,
  level INTEGER NOT NULL DEFAULT 0 CHECK (level >= 0),
  class_name TEXT,
  faction TEXT,
  avatar_url TEXT,
  metadata_json TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (server_id, character_id)
);

CREATE INDEX idx_characters_server_legion
ON game_characters(server_id, legion_name);

CREATE INDEX idx_characters_server_name
ON game_characters(server_id, character_name);

CREATE TABLE chat_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_ref INTEGER NOT NULL UNIQUE,
  last_agent_id TEXT,
  last_message_preview TEXT,
  last_message_at INTEGER,
  unread_count INTEGER NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (character_ref) REFERENCES game_characters(id) ON DELETE CASCADE
);

CREATE INDEX idx_conversations_last_message
ON chat_conversations(last_message_at DESC);

CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  source_message_id TEXT,
  request_id TEXT,
  agent_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing', 'system')),
  message_type TEXT NOT NULL DEFAULT 'text',
  sender_name_snapshot TEXT,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('pending', 'sent', 'delivered', 'received', 'failed')),
  error_message TEXT,
  raw_json TEXT,
  sent_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
);

CREATE INDEX idx_messages_conversation_time
ON chat_messages(conversation_id, sent_at DESC, id DESC);

CREATE INDEX idx_messages_agent
ON chat_messages(agent_id, sent_at DESC);

CREATE UNIQUE INDEX idx_messages_source
ON chat_messages(source_message_id)
WHERE source_message_id IS NOT NULL;

CREATE UNIQUE INDEX idx_messages_request
ON chat_messages(request_id)
WHERE request_id IS NOT NULL;
