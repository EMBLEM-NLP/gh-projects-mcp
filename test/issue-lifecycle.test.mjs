import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIssueEditArgs,
  executeIssueStateChange,
  readIssueForLifecycle,
} from '../lib/issue-lifecycle.mjs';

test('issue edit args use additive and removal label flags', () => {
  assert.deepEqual(buildIssueEditArgs({ owner: 'o', repo: 'r', number: 12, labels: ['bug'], removeLabels: ['old'] }), [
    'issue', 'edit', '12', '--repo', 'o/r', '--add-label', 'bug', '--remove-label', 'old',
  ]);
});

test('issue lifecycle reads reject pull requests', () => {
  const gh = () => ({ stdout: JSON.stringify({ number: 4, pull_request: { url: 'x' } }) });
  assert.throws(() => readIssueForLifecycle(gh, 'o', 'r', 4), /pull request/);
});

test('closing refuses before mutation unless confirm is true', () => {
  let writes = 0;
  const gh = (...args) => {
    if (args[0] === 'api') return { stdout: JSON.stringify({ number: 12, state: 'open', labels: [] }) };
    writes += 1;
    return { stdout: '' };
  };
  assert.throws(() => executeIssueStateChange(gh, {
    owner: 'o', repo: 'r', number: 12, state: 'closed', closeReason: 'completed', confirm: false,
  }), /confirm:true/);
  assert.equal(writes, 0);
});

test('confirmed close maps not_planned and verifies returned state', () => {
  const issue = { node_id: 'I_12', number: 12, title: 'x', body: '', state: 'open', state_reason: null, labels: [] };
  const calls = [];
  const gh = (...args) => {
    calls.push(args);
    if (args[0] === 'api') return { stdout: JSON.stringify(issue) };
    if (args[0] === 'issue' && args[1] === 'close') {
      issue.state = 'closed';
      issue.state_reason = 'not_planned';
    }
    return { stdout: '' };
  };
  const result = executeIssueStateChange(gh, {
    owner: 'o', repo: 'r', number: 12, state: 'closed', closeReason: 'not_planned', confirm: true,
  });
  assert.equal(result.state, 'closed');
  assert.equal(result.stateReason, 'not_planned');
  assert.ok(calls.some((args) => args.join(' ').includes('--reason not planned')));
});
