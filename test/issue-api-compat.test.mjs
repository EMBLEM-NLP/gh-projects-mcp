import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleIssueApiCompat } from '../lib/issue-api-compat.mjs';

function fakeBackend(issue = {}) {
  const calls = [];
  return {
    calls,
    rest(method, path, body) {
      calls.push({ method, path, body });
      if (method === 'GET') return issue;
      return { ...issue, ...body };
    },
  };
}

test('direct API issue edit preserves unrelated labels during add/remove', () => {
  const backend = fakeBackend({ labels: [{ name: 'keep' }, { name: 'old' }] });
  handleIssueApiCompat(backend, [
    'issue', 'edit', '12', '--repo', 'o/r', '--add-label', 'new', '--remove-label', 'old',
  ]);
  assert.deepEqual(backend.calls.at(-1).body.labels.sort(), ['keep', 'new']);
});

test('direct API issue close maps not planned reason', () => {
  const backend = fakeBackend({ number: 12 });
  handleIssueApiCompat(backend, ['issue', 'close', '12', '--repo', 'o/r', '--reason', 'not planned']);
  assert.deepEqual(backend.calls.at(-1).body, { state: 'closed', state_reason: 'not_planned' });
});

test('direct API issue reopen maps reopened reason', () => {
  const backend = fakeBackend({ number: 12 });
  handleIssueApiCompat(backend, ['issue', 'reopen', '12', '--repo', 'o/r']);
  assert.deepEqual(backend.calls.at(-1).body, { state: 'open', state_reason: 'reopened' });
});

test('unrelated issue command returns null', () => {
  assert.equal(handleIssueApiCompat(fakeBackend(), ['issue', 'list']), null);
});
