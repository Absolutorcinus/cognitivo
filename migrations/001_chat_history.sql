CREATE TABLE IF NOT EXISTS chat_conversations (
  id UUID PRIMARY KEY,
  deletion_token_hash CHAR(64) NOT NULL,
  consent_version VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'banned')),
  message_count INTEGER NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  role VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  decision VARCHAR(32) NOT NULL,
  redacted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (conversation_id, request_id, role)
);

CREATE INDEX IF NOT EXISTS chat_conversations_last_message_idx
  ON chat_conversations(last_message_at);

CREATE INDEX IF NOT EXISTS chat_messages_conversation_created_idx
  ON chat_messages(conversation_id, created_at);
