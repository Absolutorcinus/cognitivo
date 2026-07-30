const assert = require('node:assert/strict');
const test = require('node:test');

const handler = require('../api/chat');

function request(overrides = {}) {
  const { headers: headerOverrides = {}, ...requestOverrides } = overrides;
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'www.cognitivis.ai',
      origin: 'https://www.cognitivis.ai',
      'sec-fetch-site': 'same-origin',
      'x-forwarded-for': '203.0.113.10',
      'x-forwarded-proto': 'https',
      ...headerOverrides,
    },
    body: { message: 'What does Cognitivis do?', history: [] },
    socket: {},
    ...requestOverrides,
  };
}

function response() {
  return {
    headers: {},
    statusCode: 200,
    payload: undefined,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test.beforeEach(() => {
  process.env.OPENAI_API_KEY = 'test-server-only-key';
});

test.afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete global.fetch;
});

test('rejects unsupported methods without contacting OpenAI', async () => {
  global.fetch = () => {
    throw new Error('fetch should not be called');
  };
  const res = response();

  await handler(request({ method: 'GET' }), res);

  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'POST');
  assert.equal(res.headers['cache-control'], 'no-store, max-age=0');
});

test('rejects cross-site requests', async () => {
  global.fetch = () => {
    throw new Error('fetch should not be called');
  };
  const res = response();

  await handler(
    request({
      headers: {
        origin: 'https://attacker.example',
        'sec-fetch-site': 'cross-site',
        'x-forwarded-for': '203.0.113.11',
      },
    }),
    res
  );

  assert.equal(res.statusCode, 403);
});

test('rejects invalid content types and oversized messages', async () => {
  global.fetch = () => {
    throw new Error('fetch should not be called');
  };

  const contentTypeRes = response();
  await handler(
    request({
      headers: {
        'content-type': 'text/plain',
        'x-forwarded-for': '203.0.113.12',
      },
    }),
    contentTypeRes
  );
  assert.equal(contentTypeRes.statusCode, 415);

  const lengthRes = response();
  await handler(
    request({
      headers: { 'x-forwarded-for': '203.0.113.13' },
      body: { message: 'x'.repeat(1_201), history: [] },
    }),
    lengthRes
  );
  assert.equal(lengthRes.statusCode, 400);
});

test('moderates input and returns aggregated Responses API text', async () => {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/moderations')) {
      return new Response(JSON.stringify({ results: [{ flagged: false }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify({
        output: [
          { type: 'reasoning', content: [] },
          {
            type: 'message',
            content: [
              { type: 'output_text', text: 'Cognitivis builds responsible AI systems.' },
              { type: 'output_text', text: 'It also delivers document intelligence.' },
            ],
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };
  const res = response();

  await handler(
    request({ headers: { 'x-forwarded-for': '203.0.113.14' } }),
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(
    res.payload.answer,
    'Cognitivis builds responsible AI systems.\n\nIt also delivers document intelligence.'
  );
  assert.equal(calls.length, 2);

  const responseRequest = JSON.parse(calls[1].options.body);
  assert.equal(responseRequest.store, false);
  assert.equal(responseRequest.max_output_tokens, 450);
  assert.equal(responseRequest.model, 'gpt-5.6-sol');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer test-server-only-key');
});

test('blocks input flagged by moderation', async () => {
  global.fetch = async (url) => {
    assert.match(url, /\/moderations$/);
    return new Response(JSON.stringify({ results: [{ flagged: true }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const res = response();

  await handler(
    request({ headers: { 'x-forwarded-for': '203.0.113.15' } }),
    res
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.payload.error, /can’t help/);
});
