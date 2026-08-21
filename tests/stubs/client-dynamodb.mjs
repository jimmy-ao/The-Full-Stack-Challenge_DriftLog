// Minimal stand-in for @aws-sdk/client-dynamodb. Records every command the
// handler sends on globalThis.__ddb so tests can assert on the exact
// DynamoDB calls, and replays queued responses.

globalThis.__ddb = {
  calls: [],
  responses: [],
  reset() {
    this.calls = [];
    this.responses = [];
  },
  queue(response) {
    this.responses.push(response);
  },
  last() {
    return this.calls.at(-1);
  },
};

class Command {
  constructor(input) {
    this.input = input;
    this.name = this.constructor.name;
  }
}

export class PutItemCommand extends Command {}
export class QueryCommand extends Command {}
export class DeleteItemCommand extends Command {}

export class DynamoDBClient {
  async send(command) {
    globalThis.__ddb.calls.push({ name: command.name, input: command.input });
    const next = globalThis.__ddb.responses.shift();
    if (next instanceof Error) throw next;
    return next ?? {};
  }
}
