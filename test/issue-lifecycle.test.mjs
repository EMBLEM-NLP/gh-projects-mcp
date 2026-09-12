import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIssueEditArgs, readIssueForLifecycle } from '../lib/issue-lifecycle.mjs';

test('issue edit args use additive and removal label flags', () => {
  assert.deepEqual(buildIssueEditArgs({ owner: 'o', repo: 'r', number: 12, labels: ['bug'], removeLabels: ['old'] }), [
    'issue', 'edit', '12', '--repo', 'o/r', '--add-label', 'bug', '--remove-label', 'old',
  ]);
});

test('issue lifecycle reads reject pull requests', () => {
  const gh = () => ({ stdout: JSON.stringify({ number: 4, pull_request: { url: 'x' } }) });
  assert.throws(() => readIssueForLifecycle(gh, 'o', 'r', 4), /pull request/);
});
