// Minimal stand-in for @aws-sdk/util-dynamodb, enough for the shapes the
// handler actually stores: strings, numbers, booleans and null.

export function marshall(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = toAttr(v);
  return out;
}

export function unmarshall(item) {
  const out = {};
  for (const [k, v] of Object.entries(item)) out[k] = fromAttr(v);
  return out;
}

function toAttr(value) {
  if (value === null) return { NULL: true };
  if (typeof value === 'string') return { S: value };
  if (typeof value === 'number') return { N: String(value) };
  if (typeof value === 'boolean') return { BOOL: value };
  throw new Error(`Unsupported value for marshall: ${typeof value}`);
}

function fromAttr(attr) {
  if ('S' in attr) return attr.S;
  if ('N' in attr) return Number(attr.N);
  if ('BOOL' in attr) return attr.BOOL;
  if ('NULL' in attr) return null;
  throw new Error(`Unsupported attribute: ${Object.keys(attr)}`);
}
