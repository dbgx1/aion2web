DROP INDEX IF EXISTS idx_messages_request;

CREATE INDEX idx_messages_request
ON chat_messages(request_id)
WHERE request_id IS NOT NULL;
