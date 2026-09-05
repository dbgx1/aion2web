-- Global exact lookups and cross-server legion pagination cannot use the
-- existing indexes whose leading column is server_id.
CREATE INDEX IF NOT EXISTS idx_characters_character_id
ON game_characters(character_id);

CREATE INDEX IF NOT EXISTS idx_characters_character_name
ON game_characters(character_name);

CREATE INDEX IF NOT EXISTS idx_characters_legion_cursor
ON game_characters(legion_name, id);

CREATE INDEX IF NOT EXISTS idx_characters_unaffiliated_cursor
ON game_characters(id) WHERE COALESCE(legion_name, '') = '';

CREATE INDEX IF NOT EXISTS idx_characters_server_unaffiliated_cursor
ON game_characters(server_id, id) WHERE COALESCE(legion_name, '') = '';

-- History is paginated by id, not sent_at.
CREATE INDEX IF NOT EXISTS idx_messages_conversation_cursor
ON chat_messages(conversation_id, id);
