/**
 * #60 — lib/request-context.mjs's AsyncLocalStorage-based per-request
 * backend override, exercised through lib/gql.mjs's public gh()/gql()/
 * backendCapabilities() exactly as every tool handler calls them.
 *
 * This is the core identity-isolation guarantee the remote HTTP transport
 * depends on: many concurrent HTTP requests, each with its own
 * Authorization-header-derived GitHubApiBackend, share one Node process
 * and one set of module-level gh()/gql() functions. These tests prove that
 * sharing is safe — concurrent request-scoped backends never leak into
 * each other — without needing a real HTTP server (see
 * test/http-transport.test.mjs for the end-to-end version).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gh, gql, backendCapabilities, setBackendForTests, resetBackendForTests } from '../lib/gql.mjs';
import { withRequestBackend, getRequestBackend } from '../lib/request-context.mjs';

function fakeBackend(id) {
  return {
    kind: 'github-api',
    gh: (...args) => ({ stdout: JSON.stringify({ id, args }), stderr: '', status: 0 }),
    gql: (query) => ({ data: { id, query } }),
    capabilities: () => ({ backend: 'github-api', id, directApi: true, requiresGhCli: false }),
  };
}

test('getRequestBackend() is undefined outside any withRequestBackend scope', () => {
  assert.equal(getRequestBackend(), undefined);
});

test('gh()/gql()/backendCapabilities() use the process-wide backend outside any request scope (stdio path, unchanged)', () => {
  setBackendForTests(fakeBackend('process-wide'));
  try {
    assert.equal(backendCapabilities().id, 'process-wide');
    assert.equal(JSON.parse(gh('api', 'user').stdout).id, 'process-wide');
    assert.equal(gql('query{viewer{login}}').data.id, 'process-wide');
  } finally {
    resetBackendForTests();
  }
});

test('withRequestBackend overrides gh()/gql()/backendCapabilities() only for the scope of its callback', async () => {
  setBackendForTests(fakeBackend('process-wide'));
  try {
    await withRequestBackend(fakeBackend('request-scoped'), async () => {
      assert.equal(backendCapabilities().id, 'request-scoped');
      assert.equal(JSON.parse(gh('api', 'user').stdout).id, 'request-scoped');
      assert.equal(gql('query{viewer{login}}').data.id, 'request-scoped');
    });
    // Outside the scope, calls fall back to the process-wide backend again —
    // a request-scoped override must never leak past its own request.
    assert.equal(backendCapabilities().id, 'process-wide');
  } finally {
    resetBackendForTests();
  }
});

test('two concurrent request-scoped backends never observe each other\'s gh()/gql() calls', async () => {
  setBackendForTests(fakeBackend('process-wide'));
  try {
    async function run(id, delayMs) {
      return withRequestBackend(fakeBackend(id), async () => {
        // The delay forces real interleaving: both callbacks are in flight
        // at once on the same process, the way two concurrent HTTP
        // requests' tool handlers would be.
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return {
          capabilities: backendCapabilities().id,
          gh: JSON.parse(gh('api', 'user').stdout).id,
          gql: gql('query{viewer{login}}').data.id,
        };
      });
    }
    const [a, b] = await Promise.all([run('req-a', 15), run('req-b', 5)]);
    assert.deepEqual(a, { capabilities: 'req-a', gh: 'req-a', gql: 'req-a' });
    assert.deepEqual(b, { capabilities: 'req-b', gh: 'req-b', gql: 'req-b' });
  } finally {
    resetBackendForTests();
  }
});
