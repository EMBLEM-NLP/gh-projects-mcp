import { z } from 'zod';
import { gh } from './gql.mjs';
import { assertConfirmed } from './helpers.mjs';
import { executeIssueMetadataEdit, executeIssueStateChange } from './issue-lifecycle.mjs';

function text(value) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

function errorText(error) {
  return { isError: true, content: [{ type: 'text', text: error?.message ?? String(error) }] };
}

export function registerIssueLifecycleTools(server) {
  return server;
}
