import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GhCliBackend,
  GitHubApiBackend,
  createBackend,
} from '../lib/github-backend.mjs';

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

test('createBackend chooses gh-cli explicitly without a token', () => {
  const backend = createBackend({ mode: 'gh-cli', env: {} });
  assert.ok(backend instanceof GhCliBackend);
  assert.equal(backend.kind, 'gh-cli');
});

test('createBackend auto-selects direct API when a token is present', () => {
  const backend = createBackend({ env: { GH_PROJECTS_TOKEN: 'token' }, request: () => ({}) });
  assert.ok(backend instanceof GitHubApiBackend);
  assert.equal(backend.kind, 'github-api');
});

test('GitHubApiBackend requires an explicit token', () => {
  assert.throws(
    () => createBackend({ mode: 'api', env: {} }),
    /requires GH_PROJECTS_TOKEN or GITHUB_TOKEN/,
  );
});

test('GitHubApiBackend gql maps -f/-F variables without gh', () => {
  const request = requestStub([{
    data: { node: { id: 'X' } },
  }]);
  const backend = new GitHubApiBackend({ token: 'secret', request });
  const result = backend.gql(
    'query($id:ID!,$n:Int!){node(id:$id){id}}',
    '-f', 'id=X',
    '-F', 'n=7',
  );
  assert.equal(result.data.node.id, 'X');
  assert.equal(request.calls[0].method, 'POST');
  assert.equal(request.calls[0].url, 'https://api.github.com/graphql');
  assert.deepEqual(request.calls[0].body.variables, { id: 'X', n: 7 });
  assert.match(request.calls[0].headers.Authorization, /^Bearer /);
});

test('GitHubApiBackend projectList paginates organization projects', () => {
  const request = requestStub([
    { type: 'Organization' },
    {
      data: {
        organization: {
          projectsV2: {
            nodes: [{ id: 'P1', number: 1, title: 'One' }],
            pageInfo: { hasNextPage: true, endCursor: 'CURSOR' },
          },
        },
      },
    },
    {
      data: {
        organization: {
          projectsV2: {
            nodes: [{ id: 'P2', number: 2, title: 'Two' }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    },
  ]);
  const backend = new GitHubApiBackend({ token: 'secret', request });
  const result = backend.projectList('EMBLEM-NLP');
  assert.equal(result.totalCount, 2);
  assert.deepEqual(result.projects.map((p) => p.id), ['P1', 'P2']);
  assert.equal(request.calls[0].method, 'GET');
  assert.match(request.calls[0].url, /\/users\/EMBLEM-NLP$/);
  assert.equal(request.calls[2].body.variables.after, 'CURSOR');
});

test('GitHubApiBackend project view maps to gh-compatible JSON shape', () => {
  const request = requestStub([
    { type: 'Organization' },
    {
      data: {
        organization: {
          projectV2: {
            id: 'P1',
            number: 1,
            title: 'Roadmap',
            shortDescription: 'x',
            readme: '',
            closed: false,
            public: false,
            url: 'https://github.com/orgs/EMBLEM-NLP/projects/1',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
            items: { totalCount: 9 },
            fields: { totalCount: 7 },
            views: { nodes: [{ id: 'V1', name: 'Table', number: 1, layout: 'TABLE_LAYOUT' }] },
          },
        },
      },
    },
  ]);
  const backend = new GitHubApiBackend({ token: 'secret', request });
  const result = backend.projectView('EMBLEM-NLP', 1);
  assert.equal(result.owner.login, 'EMBLEM-NLP');
  assert.equal(result.owner.type, 'Organization');
  assert.equal(result.items.totalCount, 9);
  assert.deepEqual(result.views.map((v) => v.name), ['Table']);
});

test('GitHubApiBackend deleteProject resolves ID, mutates, and verifies absence', () => {
  const request = requestStub([
    { type: 'Organization' },
    {
      data: {
        organization: {
          projectV2: {
            id: 'P1', number: 1, title: 'Roadmap', shortDescription: '', readme: '', closed: false,
            public: false, url: 'u', createdAt: 'a', updatedAt: 'b',
            items: { totalCount: 0 }, fields: { totalCount: 0 }, views: { nodes: [] },
          },
        },
      },
    },
    { data: { deleteProjectV2: { projectV2: { id: 'P1' } } } },
    { data: { organization: { projectV2: null } } },
  ]);
  const backend = new GitHubApiBackend({ token: 'secret', request });
  const deletedId = backend.deleteProject('EMBLEM-NLP', 1);
  assert.equal(deletedId, 'P1');
  assert.match(request.calls[2].body.query, /deleteProjectV2/);
  assert.equal(request.calls[2].body.variables.projectId, 'P1');
});

test('GitHubApiBackend gh compatibility supports ownerRoot REST lookup', () => {
  const request = requestStub([{ type: 'Organization' }]);
  const backend = new GitHubApiBackend({ token: 'secret', request });
  const result = backend.gh('api', 'users/EMBLEM-NLP', '--jq', '.type');
  assert.equal(result.stdout, 'Organization');
});

test('GitHubApiBackend fails closed for an unmigrated gh command', () => {
  const backend = new GitHubApiBackend({ token: 'secret', request: () => ({}) });
  assert.throws(
    () => backend.gh('project', 'field-list', '1', '--owner', 'o'),
    /capability_unavailable/,
  );
});
