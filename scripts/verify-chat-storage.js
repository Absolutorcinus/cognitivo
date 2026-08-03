'use strict';

const { randomBytes, randomUUID } = require('node:crypto');
const { neon } = require('@neondatabase/serverless');
const {
  BLOCKED_CONTENT,
  deleteConversation,
  deleteExpiredConversations,
  recordBlockedEvent,
  recordExchange,
} = require('../api/chat-storage');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const sql = neon(process.env.DATABASE_URL);
  const conversationId = randomUUID();
  const blockedConversationId = randomUUID();
  const expiredConversationId = randomUUID();
  const requestId = randomUUID();
  const deletionToken = randomBytes(32).toString('hex');

  await recordExchange({ conversationId, requestId, deletionToken, consentVersion: 'test', message: 'Storage verification message', answer: 'Storage verification answer', decision: 'test' });
  const rows = await sql.query('SELECT message_count FROM chat_conversations WHERE id = $1', [conversationId]);
  if (rows[0]?.message_count !== 2) throw new Error('Stored message count was not verified');

  let wrongTokenRejected = false;
  try {
    await recordExchange({
      conversationId,
      requestId: randomUUID(),
      deletionToken: randomBytes(32).toString('hex'),
      consentVersion: 'test',
      message: 'Unauthorized append attempt',
      answer: 'This must not be stored',
      decision: 'test',
    });
  } catch {
    wrongTokenRejected = true;
  }
  const protectedRows = await sql.query(
    'SELECT message_count FROM chat_conversations WHERE id = $1',
    [conversationId]
  );
  if (!wrongTokenRejected || protectedRows[0]?.message_count !== 2) {
    throw new Error('Conversation token isolation was not verified');
  }
  const result = await deleteConversation({ conversationId, deletionToken });
  if (!result.deleted) throw new Error('Verified conversation was not deleted');

  await recordBlockedEvent({
    conversationId: blockedConversationId,
    requestId: randomUUID(),
    deletionToken,
    consentVersion: 'test',
  });
  const blockedRows = await sql.query(
    'SELECT content, redacted FROM chat_messages WHERE conversation_id = $1',
    [blockedConversationId]
  );
  if (blockedRows.length !== 1 || blockedRows[0].content !== BLOCKED_CONTENT || blockedRows[0].redacted !== true) {
    throw new Error('Blocked-content redaction was not verified');
  }
  await deleteConversation({ conversationId: blockedConversationId, deletionToken });

  await recordExchange({
    conversationId: expiredConversationId,
    requestId: randomUUID(),
    deletionToken,
    consentVersion: 'test',
    message: 'Expired verification message',
    answer: 'Expired verification answer',
    decision: 'test',
  });
  await sql.query(
    "UPDATE chat_conversations SET last_message_at = NOW() - INTERVAL '91 days' WHERE id = $1",
    [expiredConversationId]
  );
  process.env.CHAT_RETENTION_DAYS = '90';
  await deleteExpiredConversations();
  const expiredRows = await sql.query('SELECT id FROM chat_conversations WHERE id = $1', [expiredConversationId]);
  if (expiredRows.length !== 0) throw new Error('Retention cleanup was not verified');

  console.log('Chat storage write, redaction, retention cleanup, and user deletion verified.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Storage verification failed');
  process.exitCode = 1;
});
