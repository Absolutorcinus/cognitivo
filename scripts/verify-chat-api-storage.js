'use strict';

const { randomBytes, randomUUID } = require('node:crypto');
const { neon } = require('@neondatabase/serverless');
const handler = require('../api/chat');

function response() {
  return {
    headers: {},
    statusCode: 200,
    payload: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

function request(method, body, cookie) {
  return {
    method,
    headers: {
      'content-type': 'application/json',
      host: 'www.cognitivis.ai',
      origin: 'https://www.cognitivis.ai',
      'x-forwarded-for': '198.51.100.210',
      'x-forwarded-proto': 'https',
      ...(cookie ? { cookie } : {}),
    },
    body,
    socket: {},
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  process.env.OPENAI_API_KEY ||= 'unused-for-greeting';
  const sql = neon(process.env.DATABASE_URL);
  const conversationId = randomUUID();
  const deletionToken = randomBytes(32).toString('hex');
  const postBody = {
    message: 'Hi',
    history: [],
    conversationId,
    requestId: randomUUID(),
    deletionToken,
    storageConsent: true,
    consentVersion: '2026-08-03-cookie-v1',
  };

  const postResponse = response();
  await handler(request('POST', postBody), postResponse);
  if (postResponse.statusCode !== 200 || postResponse.payload?.stored !== true) {
    throw new Error('Chat API did not confirm transcript storage');
  }
  const setCookie = String(postResponse.headers['set-cookie'] || '');
  const visitorCookie = setCookie.match(/cognitivis_chat_visitor_v1=([0-9a-f]{64})/i);
  if (!visitorCookie || !/HttpOnly/i.test(setCookie) || !/SameSite=Strict/i.test(setCookie)) {
    throw new Error('Anonymous visitor cookie security was not verified');
  }
  const messages = await sql.query(
    'SELECT role, content FROM chat_messages WHERE conversation_id = $1 ORDER BY id',
    [conversationId]
  );
  if (messages.length !== 2 || messages[0].content !== 'Hi') {
    throw new Error('Chat API transcript contents were not verified');
  }
  const visitorRows = await sql.query(
    `SELECT c.visitor_id, v.browser_id_hash
     FROM chat_conversations c
     JOIN chat_visitors v ON v.id = c.visitor_id
     WHERE c.id = $1`,
    [conversationId]
  );
  if (visitorRows.length !== 1 || !visitorRows[0].visitor_id || !visitorRows[0].browser_id_hash) {
    throw new Error('Anonymous visitor number and hashed identifier were not verified');
  }
  const visitorId = visitorRows[0].visitor_id;

  const deleteResponse = response();
  await handler(
    request(
      'DELETE',
      { conversationId, deletionToken },
      `cognitivis_chat_visitor_v1=${visitorCookie[1]}`
    ),
    deleteResponse
  );
  if (deleteResponse.statusCode !== 200 || deleteResponse.payload?.deleted !== true) {
    throw new Error('Chat API deletion was not verified');
  }
  if (!/cognitivis_chat_visitor_v1=;[^,]*Max-Age=0/i.test(String(deleteResponse.headers['set-cookie'] || ''))) {
    throw new Error('Anonymous visitor cookie clearing was not verified');
  }
  const visitorAfterDeletion = await sql.query('SELECT id FROM chat_visitors WHERE id = $1', [visitorId]);
  if (visitorAfterDeletion.length !== 0) throw new Error('Deleted chat visitor record was retained');
  console.log('Chat API cookie issuance, hashed visitor number, transcript write, and deletion verified.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Chat API storage verification failed');
  process.exitCode = 1;
});
