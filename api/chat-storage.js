'use strict';

const { createHash } = require('node:crypto');
const { neon } = require('@neondatabase/serverless');

const DEFAULT_RETENTION_DAYS = 90;
const MAX_RETENTION_DAYS = 365;
const BLOCKED_CONTENT = '[Content withheld: suspicious or abusive request]';
let sqlClient;
let lastCleanupAt = 0;

function getSql() {
  if (!process.env.DATABASE_URL) {
    if (process.env.VERCEL === '1' || process.env.REQUIRE_CHAT_STORAGE === 'true') {
      throw new Error('DATABASE_URL is not configured');
    }
    return null;
  }
  if (!sqlClient) sqlClient = neon(process.env.DATABASE_URL);
  return sqlClient;
}

function hashDeletionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function hashVisitorToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function retentionDays() {
  const configured = Number.parseInt(process.env.CHAT_RETENTION_DAYS || '', 10);
  if (!Number.isFinite(configured) || configured < 1) return DEFAULT_RETENTION_DAYS;
  return Math.min(configured, MAX_RETENTION_DAYS);
}

async function maybeDeleteExpiredConversations(sql) {
  const now = Date.now();
  if (now - lastCleanupAt < 6 * 60 * 60 * 1000) return;
  await sql.query(
    'DELETE FROM chat_conversations WHERE last_message_at < NOW() - make_interval(days => $1)',
    [retentionDays()]
  );
  await sql.query(
    'DELETE FROM chat_visitors WHERE NOT EXISTS (SELECT 1 FROM chat_conversations WHERE visitor_id = chat_visitors.id)'
  );
  lastCleanupAt = now;
}

async function deleteExpiredConversations() {
  const sql = getSql();
  if (!sql) return { deleted: 0, storageDisabled: true };
  const rows = await sql.query(
    `WITH deleted AS (
       DELETE FROM chat_conversations
       WHERE last_message_at < NOW() - make_interval(days => $1)
       RETURNING 1
     )
     SELECT COUNT(*)::INTEGER AS deleted FROM deleted`,
    [retentionDays()]
  );
  await sql.query(
    'DELETE FROM chat_visitors WHERE NOT EXISTS (SELECT 1 FROM chat_conversations WHERE visitor_id = chat_visitors.id)'
  );
  lastCleanupAt = Date.now();
  return { deleted: rows[0]?.deleted || 0 };
}

async function recordExchange({
  conversationId,
  requestId,
  deletionToken,
  visitorToken,
  consentVersion,
  message,
  answer,
  decision,
}) {
  const sql = getSql();
  if (!sql) return { stored: false, storageDisabled: true };
  const deletionTokenHash = hashDeletionToken(deletionToken);
  const visitorTokenHash = hashVisitorToken(visitorToken);

  const results = await sql.transaction((tx) => [
    tx.query(
      `WITH visitor AS (
         INSERT INTO chat_visitors (browser_id_hash, first_seen_at, last_seen_at)
         VALUES ($4, NOW(), NOW())
         ON CONFLICT (browser_id_hash) DO UPDATE SET last_seen_at = NOW()
         RETURNING id
       )
       INSERT INTO chat_conversations
        (id, deletion_token_hash, consent_version, status, message_count, started_at, last_message_at, visitor_id)
       SELECT $1, $2, $3, 'active', 0, NOW(), NOW(), visitor.id FROM visitor
       ON CONFLICT (id) DO UPDATE
       SET last_message_at = NOW(),
           consent_version = EXCLUDED.consent_version,
           visitor_id = EXCLUDED.visitor_id
       WHERE chat_conversations.deletion_token_hash = EXCLUDED.deletion_token_hash
       RETURNING id`,
      [conversationId, deletionTokenHash, consentVersion, visitorTokenHash]
    ),
    tx.query(
      `INSERT INTO chat_messages
        (conversation_id, request_id, role, content, decision, redacted)
       SELECT $1::uuid, $2::uuid, 'user', $3, $5, FALSE
       FROM chat_conversations WHERE id = $1 AND deletion_token_hash = $6
       UNION ALL
       SELECT $1::uuid, $2::uuid, 'assistant', $4, $5, FALSE
       FROM chat_conversations WHERE id = $1 AND deletion_token_hash = $6
       ON CONFLICT (conversation_id, request_id, role) DO NOTHING
       RETURNING id`,
      [
        conversationId,
        requestId,
        message.slice(0, 1200),
        answer.slice(0, 2000),
        decision,
        deletionTokenHash,
      ]
    ),
    tx.query(
      `UPDATE chat_conversations
       SET message_count = (SELECT COUNT(*)::INTEGER FROM chat_messages WHERE conversation_id = $1),
           last_message_at = NOW()
       WHERE id = $1 AND deletion_token_hash = $2`,
      [conversationId, deletionTokenHash]
    ),
  ]);

  if (results[0].length !== 1) throw new Error('Conversation authorization failed');

  await maybeDeleteExpiredConversations(sql);
  return { stored: true };
}

async function recordBlockedEvent({
  conversationId,
  requestId,
  deletionToken,
  visitorToken,
  consentVersion,
}) {
  const sql = getSql();
  if (!sql) return { stored: false, storageDisabled: true };
  const deletionTokenHash = hashDeletionToken(deletionToken);
  const visitorTokenHash = hashVisitorToken(visitorToken);

  const results = await sql.transaction((tx) => [
    tx.query(
      `WITH visitor AS (
         INSERT INTO chat_visitors (browser_id_hash, first_seen_at, last_seen_at)
         VALUES ($4, NOW(), NOW())
         ON CONFLICT (browser_id_hash) DO UPDATE SET last_seen_at = NOW()
         RETURNING id
       )
       INSERT INTO chat_conversations
        (id, deletion_token_hash, consent_version, status, message_count, started_at, last_message_at, visitor_id)
       SELECT $1, $2, $3, 'banned', 0, NOW(), NOW(), visitor.id FROM visitor
       ON CONFLICT (id) DO UPDATE
       SET status = 'banned', last_message_at = NOW(), visitor_id = EXCLUDED.visitor_id
       WHERE chat_conversations.deletion_token_hash = EXCLUDED.deletion_token_hash
       RETURNING id`,
      [conversationId, deletionTokenHash, consentVersion, visitorTokenHash]
    ),
    tx.query(
      `INSERT INTO chat_messages
        (conversation_id, request_id, role, content, decision, redacted)
       SELECT $1::uuid, $2::uuid, 'system', $3, 'banned', TRUE
       FROM chat_conversations WHERE id = $1 AND deletion_token_hash = $4
       ON CONFLICT (conversation_id, request_id, role) DO NOTHING
       RETURNING id`,
      [conversationId, requestId, BLOCKED_CONTENT, deletionTokenHash]
    ),
    tx.query(
      `UPDATE chat_conversations
       SET message_count = (SELECT COUNT(*)::INTEGER FROM chat_messages WHERE conversation_id = $1),
           last_message_at = NOW()
       WHERE id = $1 AND deletion_token_hash = $2`,
      [conversationId, deletionTokenHash]
    ),
  ]);

  if (results[0].length !== 1) throw new Error('Conversation authorization failed');

  await maybeDeleteExpiredConversations(sql);
  return { stored: true, redacted: true };
}

async function deleteConversation({ conversationId, deletionToken }) {
  const sql = getSql();
  if (!sql) return { deleted: false, storageDisabled: true };
  const rows = await sql.query(
    `WITH deleted AS (
       DELETE FROM chat_conversations
       WHERE id = $1 AND deletion_token_hash = $2
       RETURNING visitor_id
     ), orphaned AS (
       DELETE FROM chat_visitors
       WHERE id IN (SELECT visitor_id FROM deleted)
         AND NOT EXISTS (
           SELECT 1 FROM chat_conversations
           WHERE visitor_id = chat_visitors.id AND id <> $1
         )
       RETURNING id
     )
     SELECT COUNT(*)::INTEGER AS deleted FROM deleted`,
    [conversationId, hashDeletionToken(deletionToken)]
  );
  return { deleted: rows[0]?.deleted === 1 };
}

module.exports = {
  BLOCKED_CONTENT,
  deleteConversation,
  deleteExpiredConversations,
  recordBlockedEvent,
  recordExchange,
  retentionDays,
};
