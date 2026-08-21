/**
 * DriftLog API — single Lambda, routed by method + path.
 *
 * Runtime: nodejs22.x (AWS SDK v3 is bundled, so this function has zero
 * npm dependencies and needs no build step — the Terraform archive_file
 * data source zips this directory as-is).
 *
 * Routes (all authenticated by the API Gateway JWT authorizer):
 *   GET    /pins            list the caller's pins, newest first
 *   POST   /pins            drop a new pin
 *   DELETE /pins/{sk}       remove a pin (sk is URI-encoded)
 *   GET    /patterns        weekly drift summary derived from the caller's pins
 */

import {
  DeleteItemCommand,
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const ddb = new DynamoDBClient({});
const TABLE = process.env.TABLE_NAME;

/** The eight bearings of the inner compass. Kept in sync with web/app.js. */
const BEARINGS = {
  clarity: 0,
  creativity: 45,
  courage: 90,
  connection: 135,
  calm: 180,
  care: 225,
  curiosity: 270,
  challenge: 315,
};

const MAX_NOTE = 280;
const PAGE_LIMIT = 200;

export const handler = async (event) => {
  const method = event?.requestContext?.http?.method ?? 'GET';
  const path = event?.rawPath ?? '/';
  const userId = event?.requestContext?.authorizer?.jwt?.claims?.sub;

  if (!userId) return reply(401, { error: 'Unauthenticated' });

  try {
    if (method === 'GET' && path === '/pins') return await listPins(userId, event);
    if (method === 'POST' && path === '/pins') return await createPin(userId, event);
    if (method === 'DELETE' && path.startsWith('/pins/')) {
      const sk = decodeURIComponent(path.slice('/pins/'.length));
      return await deletePin(userId, sk);
    }
    if (method === 'GET' && path === '/patterns') return await patterns(userId);
    return reply(404, { error: 'No such route' });
  } catch (err) {
    console.error('Unhandled error', err);
    return reply(500, { error: 'Something went wrong on our end' });
  }
};

/* ------------------------------------------------------------------ */

async function listPins(userId, event) {
  const limit = clampInt(event?.queryStringParameters?.limit, 1, PAGE_LIMIT, 100);
  const out = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: marshall({ ':pk': pk(userId), ':prefix': 'PIN#' }),
      ScanIndexForward: false, // newest first
      Limit: limit,
    })
  );
  const pins = (out.Items ?? []).map(unmarshall).map(toPublic);
  return reply(200, { pins });
}

async function createPin(userId, event) {
  const body = parseBody(event);
  if (!body) return reply(400, { error: 'Body must be JSON' });

  const category = String(body.category ?? '').toLowerCase();
  if (!(category in BEARINGS)) {
    return reply(400, {
      error: `category must be one of: ${Object.keys(BEARINGS).join(', ')}`,
    });
  }

  const intensity = Number(body.intensity);
  if (!Number.isInteger(intensity) || intensity < 1 || intensity > 5) {
    return reply(400, { error: 'intensity must be an integer from 1 to 5' });
  }

  const note = String(body.note ?? '').trim();
  if (!note) return reply(400, { error: 'note is required' });
  if (note.length > MAX_NOTE) {
    return reply(400, { error: `note must be ${MAX_NOTE} characters or fewer` });
  }

  // Client may supply the moment it actually happened; default to now.
  const occurredAt = validIso(body.occurredAt) ?? new Date().toISOString();
  const id = crypto.randomUUID();
  const sk = `PIN#${occurredAt}#${id}`;

  const item = {
    pk: pk(userId),
    sk,
    id,
    category,
    bearing: BEARINGS[category],
    intensity,
    note,
    occurredAt,
    createdAt: new Date().toISOString(),
  };

  await ddb.send(
    new PutItemCommand({
      TableName: TABLE,
      Item: marshall(item),
      ConditionExpression: 'attribute_not_exists(sk)',
    })
  );

  return reply(201, { pin: toPublic(item) });
}

async function deletePin(userId, sk) {
  if (!sk.startsWith('PIN#')) return reply(400, { error: 'Invalid pin id' });
  await ddb.send(
    new DeleteItemCommand({
      TableName: TABLE,
      Key: marshall({ pk: pk(userId), sk }),
    })
  );
  return reply(204, null);
}

/**
 * The Drift Pattern Engine, lightweight edition: read the last 7 days of pins
 * and surface the rhythms — dominant bearing, busiest weekday, busiest part of
 * the day, and a per-category tally the client draws as a compass rose.
 */
async function patterns(userId) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const out = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND sk >= :since',
      ExpressionAttributeValues: marshall({ ':pk': pk(userId), ':since': `PIN#${since}` }),
      ScanIndexForward: false,
      Limit: PAGE_LIMIT,
    })
  );

  const pins = (out.Items ?? []).map(unmarshall);
  const byCategory = {};
  const byWeekday = {};
  const byPartOfDay = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  let intensitySum = 0;

  for (const p of pins) {
    byCategory[p.category] = (byCategory[p.category] ?? 0) + 1;
    const d = new Date(p.occurredAt);
    const weekday = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    byWeekday[weekday] = (byWeekday[weekday] ?? 0) + 1;
    byPartOfDay[partOfDay(d.getUTCHours())] += 1;
    intensitySum += Number(p.intensity) || 0;
  }

  return reply(200, {
    window: { since, until: new Date().toISOString() },
    total: pins.length,
    averageIntensity: pins.length ? +(intensitySum / pins.length).toFixed(2) : 0,
    heading: topKey(byCategory),
    busiestWeekday: topKey(byWeekday),
    busiestPartOfDay: topKey(byPartOfDay),
    byCategory,
    byWeekday,
    byPartOfDay,
  });
}

/* ------------------------------ helpers ---------------------------- */

const pk = (userId) => `USER#${userId}`;

function toPublic({ pk: _pk, sk, ...rest }) {
  return { sk, ...rest };
}

function partOfDay(hour) {
  if (hour < 6) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

function topKey(counts) {
  let best = null;
  let bestN = 0;
  for (const [k, n] of Object.entries(counts)) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best ? { key: best, count: bestN } : null;
}

function parseBody(event) {
  if (!event.body) return null;
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function validIso(value) {
  if (typeof value !== 'string') return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  // Refuse timestamps far in the future — a pin is a record of what happened.
  if (t > Date.now() + 5 * 60 * 1000) return null;
  return new Date(t).toISOString();
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: body === null ? '' : JSON.stringify(body),
  };
}
