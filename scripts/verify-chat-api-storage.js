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

function request(method, body) {
  return {
    method,
    headers: {
      'content-type': 'application/json',
      host: 'www.cognitivis.ai',
      origin: 'https://www.cognitivis.ai',
      'x-forwarded-for': '198.51.100.210',
      'x-forwarded-proto': 'https',
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
    consentVersion: '2026-08-03',
  };

  const postResponse = response();
  await handler(request('POST', postBody), postResponse);
  if (postResponse.statusCode !== 200 || postResponse.payload?.stored !== true) {
    throw new Error('Chat API did not confirm transcript storage');
  }
  const messages = await sql.query(
    'SELECT role, content FROM chat_messages WHERE conversation_id = $1 ORDER BY id',
    [conversationId]
  );
  if (messages.length !== 2 || messages[0].content !== 'Hi') {
    throw new Error('Chat API transcript contents were not verified');
  }

  const deleteResponse = response();
  await handler(request('DELETE', { conversationId, deletionToken }), deleteResponse);
  if (deleteResponse.statusCode !== 200 || deleteResponse.payload?.deleted !== true) {
    throw new Error('Chat API deletion was not verified');
  }
  console.log('Chat API storage acknowledgement, transcript write, and deletion verified.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Chat API storage verification failed');
  process.exitCode = 1;
});
