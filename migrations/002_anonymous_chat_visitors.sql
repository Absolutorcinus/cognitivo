CREATE TABLE IF NOT EXISTS chat_visitors (
  id BIGSERIAL PRIMARY KEY,
  browser_id_hash CHAR(64) NOT NULL UNIQUE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS visitor_id BIGINT REFERENCES chat_visitors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS chat_conversations_visitor_started_idx
  ON chat_conversations(visitor_id, started_at DESC);

CREATE OR REPLACE VIEW chat_transcript_admin AS
SELECT
  v.id AS anonymous_visitor_number,
  c.id AS conversation_id,
  c.status,
  c.started_at AS conversation_started_at,
  c.last_message_at,
  c.message_count,
  m.id AS message_id,
  m.created_at AS message_created_at,
  m.role,
  m.content,
  m.decision,
  m.redacted
FROM chat_conversations c
LEFT JOIN chat_visitors v ON v.id = c.visitor_id
LEFT JOIN chat_messages m ON m.conversation_id = c.id;
