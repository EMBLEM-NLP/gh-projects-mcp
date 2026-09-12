import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitHubApiBackend } from '../lib/github-backend.mjs';

function requestStub(responses) {
  const calls = [];
  const fn = (request) => {
    calls.push(request);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(request);
    return next;
  };
  fn.calls = calls;
  return fn;
}

test('API backend maps gh issue create with body file, labels, and milestone title', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gh-projects-api-'));
  const bodyFile = join(dir, 'body.md');
  writeFileSync(bodyFile, 'Issue body\nwith markdown', 'utf8');
  try {
    const request = requestStub([
      [{ number: 7, title: 'Sprint 1' }],
      { number: 42, html_url: 'https://github.com/o/r/issues/42' },
    ]);
    const backend = new GitHubApiBackend({ token: 'secret', request });
    const result = backend.gh(
      'issue', 'create',
      '--repo', 'o/r',
      '--title', 'Test issue',
      '--body-file', bodyFile,
      '--label', 'bug',
      '--label', 'P0',
      '--milestone', 'Sprint 1',
    );

    assert.equal(result.stdout, 'https://github.com/o/r/issues/42');
    assert.match(request.calls[0].url, /\/repos\/o\/r\/milestones\?/);
    assert.equal(request.calls[1].method, 'POST');
    assert.match(request.calls[1].url, /\/repos\/o\/r\/issues$/);
    assert.deepEqual(request.calls[1].body, {
      title: 'Test issue',
      body: 'Issue body\nwith markdown',
      labels: ['bug', 'P0'],
      milestone: 7,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('API backend issue list excludes pull requests and exposes GraphQL node IDs', () => {
  const request = requestStub([[
    {
      node_id: 'I_kw1',
      number: 1,
      title: 'Issue',
      html_url: 'https://github.com/o/r/issues/1',
      state: 'open',
      labels: [{ node_id: 'L1', name: 'bug', color: 'ff0000', description: 'Bug' }],
    },
    {
      node_id: 'PR_kw2',
      number: 2,
      title: 'PR disguised as issue',
      html_url: 'https://github.com/o/r/pull/2',
      state: 'open',
      labels: [],
      pull_request: { url: 'x' },
    },
  ]]);
  const backend = new GitHubApiBackend({ token: 'secret', request });
  const result = backend.gh(
    'issue', 'list', '--repo', 'o/r', '--state', 'open', '--limit', '200', '--json', 'id,number,title,url,state,labels',
  );
  const issues = JSON.parse(result.stdout);
  assert.equal(issues.length, 1);
  assert.deepEqual(issues[0], {
    id: 'I_kw1',
    number: 1,
    title: 'Issue',
    url: 'https://github.com/o/r/issues/1',
    state: 'OPEN',
    labels: [{ id: 'L1', name: 'bug', color: 'ff0000', description: 'Bug' }],
  });
});

test('API backend maps label list and create', () => {
  const request = requestStub([
    [{ name: 'bug', color: 'ff0000' }],
    { name: 'P0', color: '000000', description: 'Critical' },
  ]);
  const backend = new GitHubApiBackend({ token: 'secret', request });

  const listed = backend.gh('label', 'list', '--repo', 'o/r', '--json', 'name');
  assert.deepEqual(JSON.parse(listed.stdout).map((label) => label.name), ['bug']);

  backend.gh('label', 'create', 'P0', '--repo', 'o/r', '--color', '000000', '--description', 'Critical');
  assert.equal(request.calls[1].method, 'POST');
  assert.deepEqual(request.calls[1].body, { name: 'P0', color: '000000', description: 'Critical' });
});

test('API backend maps gh pr create', () => {
  const request = requestStub([{ html_url: 'https://github.com/o/r/pull/9', number: 9 }]);
  const backend = new GitHubApiBackend({ token: 'secret', request });
  const result = backend.gh(
    'pr', 'create', '--repo', 'o/r', '--base', 'main', '--head', 'feat/x', '--title', 'Feature', '--body', 'Body', '--draft',
  );
  assert.equal(result.stdout, 'https://github.com/o/r/pull/9');
  assert.deepEqual(request.calls[0].body, {
    title: 'Feature', body: 'Body', base: 'main', head: 'feat/x', draft: true,
  });
});

test('API backend maps gh pr list through GraphQL', () => {
  const request = requestStub([{
    data: {
      repository: {
        pullRequests: {
          nodes: [{
            number: 9,
            title: 'Feature',
            url: 'https://github.com/o/r/pull/9',
            state: 'OPEN',
            headRefName: 'feat/x',
            baseRefName: 'main',
            mergeable: 'MERGEABLE',
            isDraft: false,
          }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    },
  }]);
  const backend = new GitHubApiBackend({ token: 'secret', request });
  const result = backend.gh(
    'pr', 'list', '--repo', 'o/r', '--state', 'open', '--limit', '50', '--json', 'number,title,url,state,headRefName,baseRefName,mergeable,isDraft',
  );
  const prs = JSON.parse(result.stdout);
  assert.equal(prs[0].number, 9);
  assert.deepEqual(request.calls[0].body.variables.states, ['OPEN']);
});

test('API backend merges PR and deletes same-repo branch without turning cleanup failure into a second merge', () => {
  const request = requestStub([
    { head: { ref: 'feat/x', repo: { full_name: 'o/r' } } },
    { merged: true, message: 'Pull Request successfully merged', sha: 'abc' },
    '',
  ]);
  const backend = new GitHubApiBackend({ token: 'secret', request });
  const result = backend.gh('pr', 'merge', '9', '--repo', 'o/r', '--squash', '--delete-branch');
  assert.match(result.stdout, /Merged PR #9 \(squash\)/);
  assert.match(result.stdout, /Branch cleanup: deleted/);
  assert.equal(request.calls[1].method, 'PUT');
  assert.deepEqual(request.calls[1].body, { merge_method: 'squash' });
  assert.equal(request.calls[2].method, 'DELETE');
  assert.match(request.calls[2].url, /git\/refs\/heads\/feat\/x$/);
});

test('API backend skips branch deletion for fork PRs', () => {
  const request = requestStub([
    { head: { ref: 'feat/x', repo: { full_name: 'fork-owner/r' } } },
    { merged: true, message: 'ok', sha: 'abc' },
  ]);
  const backend = new GitHubApiBackend({ token: 'secret', request });
  const result = backend.gh('pr', 'merge', '9', '--repo', 'o/r', '--rebase', '--delete-branch');
  assert.match(result.stdout, /skipped-external-head:fork-owner\/r/);
  assert.equal(request.calls.length, 2);
});
