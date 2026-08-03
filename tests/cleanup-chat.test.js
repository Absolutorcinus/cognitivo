'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const handler = require('../api/cleanup-chat');

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

test.afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.DATABASE_URL;
});

test('rejects retention cleanup requests without the cron secret', async () => {
  process.env.CRON_SECRET = 'test-cron-secret';
  const res = response();
  await handler({ method: 'GET', headers: { authorization: 'Bearer wrong-secret' } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.headers['cache-control'], 'no-store, max-age=0');
});

test('accepts the scheduled cleanup request with the cron secret', async () => {
  process.env.CRON_SECRET = 'test-cron-secret';
  const res = response();
  await handler({ method: 'GET', headers: { authorization: 'Bearer test-cron-secret' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { ok: true, deleted: 0 });
});
