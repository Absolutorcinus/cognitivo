'use strict';

const { timingSafeEqual } = require('node:crypto');
const { deleteExpiredConversations } = require('./chat-storage');

function authorized(value) {
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`;
  if (!process.env.CRON_SECRET || typeof value !== 'string' || value.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!authorized(req.headers.authorization)) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const result = await deleteExpiredConversations();
    return res.status(200).json({ ok: true, deleted: result.deleted });
  } catch (error) {
    console.error('Chat retention cleanup failed', error instanceof Error ? error.message : 'unknown error');
    return res.status(500).json({ error: 'Retention cleanup failed.' });
  }
};
