/**
 * Unit tests for the DriftLog Lambda handler.
 *
 *   node tests/api.test.mjs
 *
 * The AWS SDK is swapped for in-memory fakes via module resolution hooks, so
 * the handler under test is the exact file Terraform ships — no test-only
 * branches, no network, no credentials.
 */

import { register } from 'node:module';
import { marshall } from './stubs/util-dynamodb.mjs';

register('./stubs/hooks.mjs', import.meta.url);

process.env.TABLE_NAME = 'driftlog-test-pins';

const { handler } = await import('../backend/src/index.mjs');
const ddb = globalThis.__ddb;

const results = [];
async function test(name, fn) {
  try {
    ddb.reset();
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message ?? 'assertion failed');
}

function equal(actual, expected, message) {
  assert(
    actual === expected,
    message ?? `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

const USER = 'user-abc-123';

const event = ({ method = 'GET', path = '/pins', body, query, sub = USER } = {}) => ({
  rawPath: path,
  queryStringParameters: query,
  body: body === undefined ? undefined : JSON.stringify(body),
  requestContext: {
    http: { method },
    authorizer: sub ? { jwt: { claims: { sub } } } : undefined,
  },
});

const json = (res) => (res.body ? JSON.parse(res.body) : null);

/* ------------------------------- auth ---------------------------------- */

await test('rejects an unauthenticated request', async () => {
  const res = await handler(event({ sub: null }));
  equal(res.statusCode, 401);
  equal(ddb.calls.length, 0, 'must not touch DynamoDB');
});

await test('returns 404 for an unknown route', async () => {
  const res = await handler(event({ path: '/nope' }));
  equal(res.statusCode, 404);
});

/* ------------------------------ create --------------------------------- */

await test('creates a pin and scopes it to the caller', async () => {
  const res = await handler(
    event({
      method: 'POST',
      path: '/pins',
      body: { category: 'courage', intensity: 4, note: 'Said the hard thing.' },
    })
  );

  equal(res.statusCode, 201);
  const { pin } = json(res);
  equal(pin.category, 'courage');
  equal(pin.bearing, 90, 'courage points east');
  equal(pin.intensity, 4);
  assert(pin.sk.startsWith('PIN#'), 'sort key is prefixed');

  const call = ddb.last();
  equal(call.name, 'PutItemCommand');
  equal(call.input.TableName, 'driftlog-test-pins');
  equal(call.input.Item.pk.S, `USER#${USER}`, 'partition key is the caller');
  assert(
    call.input.ConditionExpression.includes('attribute_not_exists'),
    'writes must not clobber an existing pin'
  );
});

await test('rejects an unknown category', async () => {
  const res = await handler(
    event({ method: 'POST', path: '/pins', body: { category: 'vibes', intensity: 3, note: 'hi' } })
  );
  equal(res.statusCode, 400);
  assert(json(res).error.includes('category'));
  equal(ddb.calls.length, 0);
});

await test('rejects an out-of-range intensity', async () => {
  for (const intensity of [0, 6, 2.5, 'high']) {
    const res = await handler(
      event({ method: 'POST', path: '/pins', body: { category: 'calm', intensity, note: 'hi' } })
    );
    equal(res.statusCode, 400, `intensity ${intensity} should be rejected`);
  }
});

await test('rejects an empty or oversized note', async () => {
  const empty = await handler(
    event({ method: 'POST', path: '/pins', body: { category: 'calm', intensity: 3, note: '   ' } })
  );
  equal(empty.statusCode, 400);

  const huge = await handler(
    event({
      method: 'POST',
      path: '/pins',
      body: { category: 'calm', intensity: 3, note: 'x'.repeat(281) },
    })
  );
  equal(huge.statusCode, 400);
});

await test('rejects malformed JSON', async () => {
  const res = await handler({
    rawPath: '/pins',
    body: '{not json',
    requestContext: { http: { method: 'POST' }, authorizer: { jwt: { claims: { sub: USER } } } },
  });
  equal(res.statusCode, 400);
});

await test('ignores a future occurredAt and falls back to now', async () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const res = await handler(
    event({
      method: 'POST',
      path: '/pins',
      body: { category: 'clarity', intensity: 2, note: 'ok', occurredAt: future },
    })
  );
  equal(res.statusCode, 201);
  const { pin } = json(res);
  assert(new Date(pin.occurredAt).getTime() <= Date.now() + 1000, 'no time travel');
});

await test('honours a valid past occurredAt', async () => {
  const past = '2026-08-01T10:00:00.000Z';
  const res = await handler(
    event({
      method: 'POST',
      path: '/pins',
      body: { category: 'care', intensity: 3, note: 'ok', occurredAt: past },
    })
  );
  equal(json(res).pin.occurredAt, past);
});

/* -------------------------------- list --------------------------------- */

await test('lists the caller pins newest first', async () => {
  ddb.queue({
    Items: [
      marshall({ pk: `USER#${USER}`, sk: 'PIN#b', id: 'b', category: 'calm', intensity: 2, note: 'b', occurredAt: '2026-08-19T10:00:00.000Z' }),
    ],
  });

  const res = await handler(event({ path: '/pins' }));
  equal(res.statusCode, 200);
  const { pins } = json(res);
  equal(pins.length, 1);
  equal(pins[0].pk, undefined, 'internal partition key is not leaked');

  const call = ddb.last();
  equal(call.name, 'QueryCommand');
  equal(call.input.ScanIndexForward, false);
  equal(call.input.ExpressionAttributeValues[':pk'].S, `USER#${USER}`);
});

await test('clamps an absurd limit', async () => {
  ddb.queue({ Items: [] });
  await handler(event({ path: '/pins', query: { limit: '99999' } }));
  equal(ddb.last().input.Limit, 200);

  ddb.queue({ Items: [] });
  await handler(event({ path: '/pins', query: { limit: 'banana' } }));
  equal(ddb.last().input.Limit, 100, 'falls back to the default');
});

/* ------------------------------- delete -------------------------------- */

await test('deletes only within the caller partition', async () => {
  const sk = 'PIN#2026-08-19T10:00:00.000Z#abc';
  const res = await handler({
    rawPath: `/pins/${encodeURIComponent(sk)}`,
    requestContext: { http: { method: 'DELETE' }, authorizer: { jwt: { claims: { sub: USER } } } },
  });

  equal(res.statusCode, 204);
  const call = ddb.last();
  equal(call.name, 'DeleteItemCommand');
  equal(call.input.Key.pk.S, `USER#${USER}`);
  equal(call.input.Key.sk.S, sk);
});

await test('refuses a delete key that is not a pin', async () => {
  const res = await handler({
    rawPath: '/pins/PROFILE%23secret',
    requestContext: { http: { method: 'DELETE' }, authorizer: { jwt: { claims: { sub: USER } } } },
  });
  equal(res.statusCode, 400);
  equal(ddb.calls.length, 0);
});

/* ------------------------------ patterns ------------------------------- */

await test('summarises the week into a drift pattern', async () => {
  const iso = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600_000).toISOString();
  ddb.queue({
    Items: [
      { category: 'creativity', intensity: 5, occurredAt: iso(2) },
      { category: 'creativity', intensity: 3, occurredAt: iso(26) },
      { category: 'calm', intensity: 2, occurredAt: iso(50) },
    ].map((p, i) => marshall({ pk: `USER#${USER}`, sk: `PIN#${i}`, ...p })),
  });

  const res = await handler(event({ path: '/patterns' }));
  equal(res.statusCode, 200);
  const body = json(res);
  equal(body.total, 3);
  equal(body.heading.key, 'creativity');
  equal(body.heading.count, 2);
  equal(body.averageIntensity, 3.33);
  assert(body.busiestPartOfDay !== null, 'part of day is derived');
});

await test('handles an empty week without dividing by zero', async () => {
  ddb.queue({ Items: [] });
  const res = await handler(event({ path: '/patterns' }));
  equal(json(res).averageIntensity, 0);
  equal(json(res).heading, null);
});

/* ------------------------------- failure ------------------------------- */

await test('turns an unexpected DynamoDB failure into a 500, not a stack trace', async () => {
  ddb.queue(new Error('ProvisionedThroughputExceeded'));
  const res = await handler(event({ path: '/pins' }));
  equal(res.statusCode, 500);
  assert(!JSON.stringify(json(res)).includes('ProvisionedThroughput'), 'internals stay internal');
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
