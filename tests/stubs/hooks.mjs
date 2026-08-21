// Module resolution hooks that redirect the AWS SDK imports in the Lambda
// handler to the in-memory fakes below it. This lets the handler be tested as
// the real, unmodified module — no dependency injection, no node_modules.

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

const MAP = {
  '@aws-sdk/client-dynamodb': path.join(here, 'client-dynamodb.mjs'),
  '@aws-sdk/util-dynamodb': path.join(here, 'util-dynamodb.mjs'),
};

export function resolve(specifier, context, next) {
  const target = MAP[specifier];
  if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
  return next(specifier, context);
}
