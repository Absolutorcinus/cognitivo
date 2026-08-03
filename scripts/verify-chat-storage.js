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

function token() {
  return randomBytes(32).toString('hex');
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const sql = neon(process.env.DATABASE_URL);
  const conversationId = randomUUID();
  const secondConversationId = randomUUID();
  const blockedConversationId = randomUUID();
  const expiredConversationId = randomUUID();
  const deletionToken = token();
  const visitorToken = token();
  const blockedVisitorToken = token();
  const expiredVisitorToken = token();

  const baseExchange = {
    deletionToken,
    visitorToken,
    consentVersion: 'test',
    message: 'Storage verification message',
    answer: 'Storage verification answer',
    decision: 'test',
  };
  await recordExchange({ ...baseExchange, conversationId, requestId: randomUUID() });
  await recordExchange({
    ...baseExchange,
    conversationId: secondConversationId,
    requestId: randomUUID(),
  });

  const visitorRows = await sql.query(
    'SELECT id, visitor_id, message_count FROM chat_conversations WHERE id = ANY($1::uuid[]) ORDER BY id',
    [[conversationId, secondConversationId]]
  );
  if (
    visitorRows.length !== 2 ||
    !visitorRows[0].visitor_id ||
    visitorRows[0].visitor_id !== visitorRows[1].visitor_id ||
    visitorRows.some((row) => row.message_count !== 2)
  ) {
    throw new Error('Anonymous browser grouping was not verified');
  }
  const sharedVisitorId = visitorRows[0].visitor_id;
  const adminViewRows = await sql.query(
    'SELECT anonymous_visitor_number FROM chat_transcript_admin WHERE conversation_id = $1 LIMIT 1',
    [conversationId]
  );
  if (adminViewRows[0]?.anonymous_visitor_number !== sharedVisitorId) {
    throw new Error('Admin transcript visitor number view was not verified');
  }

  let wrongTokenRejected = false;
  try {
    await recordExchange({
      ...baseExchange,
      conversationId,
      requestId: randomUUID(),
      deletionToken: token(),
      message: 'Unauthorized append attempt',
      answer: 'This must not be stored',
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

  await recordBlockedEvent({
    conversationId: blockedConversationId,
    requestId: randomUUID(),
    deletionToken,
    visitorToken: blockedVisitorToken,
    consentVersion: 'test',
  });
  const blockedRows = await sql.query(
    `SELECT m.content, m.redacted, c.visitor_id
     FROM chat_messages m
     JOIN chat_conversations c ON c.id = m.conversation_id
     WHERE m.conversation_id = $1`,
    [blockedConversationId]
  );
  if (
    blockedRows.length !== 1 ||
    blockedRows[0].content !== BLOCKED_CONTENT ||
    blockedRows[0].redacted !== true ||
    blockedRows[0].visitor_id === sharedVisitorId
  ) {
    throw new Error('Blocked-content redaction or separate-device numbering was not verified');
  }
  const blockedVisitorId = blockedRows[0].visitor_id;
  await deleteConversation({ conversationId: blockedConversationId, deletionToken });
  const deletedBlockedVisitor = await sql.query('SELECT id FROM chat_visitors WHERE id = $1', [blockedVisitorId]);
  if (deletedBlockedVisitor.length !== 0) throw new Error('Orphaned blocked visitor was not removed');

  await recordExchange({
    ...baseExchange,
    conversationId: expiredConversationId,
    requestId: randomUUID(),
    visitorToken: expiredVisitorToken,
  });
  const expiredVisitorRows = await sql.query(
    'SELECT visitor_id FROM chat_conversations WHERE id = $1',
    [expiredConversationId]
  );
  await sql.query(
    "UPDATE chat_conversations SET last_message_at = NOW() - INTERVAL '91 days' WHERE id = $1",
    [expiredConversationId]
  );
  process.env.CHAT_RETENTION_DAYS = '90';
  await deleteExpiredConversations();
  const expiredRows = await sql.query('SELECT id FROM chat_conversations WHERE id = $1', [expiredConversationId]);
  const expiredVisitorAfterCleanup = await sql.query('SELECT id FROM chat_visitors WHERE id = $1', [expiredVisitorRows[0].visitor_id]);
  if (expiredRows.length !== 0 || expiredVisitorAfterCleanup.length !== 0) {
    throw new Error('Retention cleanup and visitor minimization were not verified');
  }

  await deleteConversation({ conversationId, deletionToken });
  const visitorStillGrouped = await sql.query('SELECT id FROM chat_visitors WHERE id = $1', [sharedVisitorId]);
  if (visitorStillGrouped.length !== 1) throw new Error('Shared browser was removed too early');
  await deleteConversation({ conversationId: secondConversationId, deletionToken });
  const visitorAfterDeletion = await sql.query('SELECT id FROM chat_visitors WHERE id = $1', [sharedVisitorId]);
  if (visitorAfterDeletion.length !== 0) throw new Error('Orphaned browser identifier was not removed');

  console.log('Chat storage, anonymous browser numbering, isolation, redaction, retention, and deletion verified.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Storage verification failed');
  process.exitCode = 1;
});
