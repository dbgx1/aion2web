PRAGMA foreign_keys = OFF;

DROP INDEX IF EXISTS idx_messages_conversation_time;
DROP INDEX IF EXISTS idx_messages_agent;
DROP INDEX IF EXISTS idx_messages_source;
DROP INDEX IF EXISTS idx_messages_request;
DROP INDEX IF EXISTS idx_conversations_last_message;
DROP INDEX IF EXISTS idx_conversations_owner_last;

DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS chat_conversations;

CREATE TABLE chat_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_ref INTEGER NOT NULL,
  owner_user_key TEXT NOT NULL,
  owner_username TEXT NOT NULL,
  last_agent_id TEXT,
  last_message_preview TEXT,
  last_message_at INTEGER,
  unread_count INTEGER NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (character_ref) REFERENCES game_characters(id) ON DELETE CASCADE,
  UNIQUE (character_ref, owner_user_key)
);

CREATE INDEX idx_conversations_last_message
ON chat_conversations(last_message_at DESC);

CREATE INDEX idx_conversations_owner_last
ON chat_conversations(owner_user_key, last_message_at DESC);

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
  operator_user_key TEXT,
  operator_username TEXT,
  sent_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
);

CREATE INDEX idx_messages_conversation_time
ON chat_messages(conversation_id, sent_at DESC, id DESC);

CREATE INDEX idx_messages_agent
ON chat_messages(agent_id, sent_at DESC);

CREATE UNIQUE INDEX idx_messages_source
ON chat_messages(conversation_id, source_message_id)
WHERE source_message_id IS NOT NULL;

CREATE INDEX idx_messages_request
ON chat_messages(conversation_id, request_id)
WHERE request_id IS NOT NULL;

PRAGMA foreign_keys = ON;
