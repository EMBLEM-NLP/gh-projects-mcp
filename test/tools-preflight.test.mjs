import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePreflightHandler, registerPreflightTool } from '../lib/tools-preflight.mjs';

function payload(response) {
  return JSON.parse(response.content[0].text);
}

test('gh_preflight reports the configured backend/capability matrix without live I/O by default', async () => {
  let ghCalled = false;
  let gqlCalled = false;
  const handler = makePreflightHandler({
    gh: () => { ghCalled = true; },
    gql: () => { gqlCalled = true; },
    getBackend: () => ({ kind: 'github-api', capabilities: () => ({ directApi: true, requiresGhCli: false }) }),
    transport: 'stdio',
  });
  const response = await handler({});
  assert.equal(response.isError, undefined);
  const report = payload(response);
  assert.equal(report.transport, 'stdio');
  assert.equal(report.backend, 'github-api');
  assert.equal(ghCalled, false);
  assert.equal(gqlCalled, false);
});

test('gh_preflight live:true performs the injected gh/gql round trip', async () => {
  const calls = [];
  const handler = makePreflightHandler({
    gh: (...args) => { calls.push(['gh', ...args]); return { stdout: '{}' }; },
    gql: (query) => { calls.push(['gql', query]); return { data: { viewer: { login: 'octocat' } } }; },
    getBackend: () => ({ kind: 'github-api', capabilities: () => ({}) }),
  });
  const response = await handler({ live: true });
  const report = payload(response);
  assert.equal(report.rest, 'ready');
  assert.equal(report.graphql, 'ready');
  assert.deepEqual(calls[0], ['gh', 'api', 'user']);
  assert.equal(calls[1][0], 'gql');
});

test('gh_preflight never leaks a token value even when the backend/gh/gql surface one in errors', async () => {
  const token = 'ghp_should_never_appear';
  const handler = makePreflightHandler({
    gh: () => { throw new Error(`401 for token ${token}`); },
    gql: () => { throw new Error(`graphql rejected ${token}`); },
    getBackend: () => ({ kind: 'github-api', capabilities: () => ({}) }),
  });
  // detectRuntimeCapabilities reads secrets from env; simulate that via a real env var.
  process.env.GH_PROJECTS_TOKEN = token;
  try {
    const response = await handler({ live: true });
    assert.doesNotMatch(response.content[0].text, new RegExp(token));
  } finally {
    delete process.env.GH_PROJECTS_TOKEN;
  }
});

test('registerPreflightTool wires gh_preflight into the server with a live-boolean schema', () => {
  const registered = [];
  const fakeServer = { tool: (name, description, schema, handler) => registered.push({ name, description, schema, handler }) };
  registerPreflightTool(fakeServer, {
    gh: () => ({}),
    gql: () => ({}),
    getBackend: () => ({ kind: 'gh-cli', capabilities: () => ({}) }),
  });
  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, 'gh_preflight');
  assert.ok('live' in registered[0].schema);
});

test('errors from detection surface as MCP errors rather than throwing', async () => {
  const handler = makePreflightHandler({
    getBackend: () => { throw new Error('boom'); },
  });
  const response = await handler({});
  assert.equal(response.isError, true);
  assert.match(response.content[0].text, /boom/);
});
