/**
 * #60 — remote HTTP MCP transport: end-to-end tests against a real
 * `node:http` server bound to 127.0.0.1 on an ephemeral port (never a
 * public host — see lib/http-transport.mjs's doc comment).
 *
 * Covers the three behaviors #60 explicitly calls out for testing:
 *   1. the HTTP transport serves the same `tools/list` as stdio (extends
 *      #63's contract parity gate — see scripts/tool-contract.mjs — to the
 *      remote transport);
 *   2. auth/identity boundary behavior: missing/malformed bearer rejected,
 *      valid bearer accepted, and concurrent requests with different
 *      bearer tokens never see each other's backend;
 *   3. `gh_preflight` reports `transport: "http"` when running under this
 *      transport, via the same #64 capability model stdio uses.
 *
 * No real GitHub network calls are made anywhere in this file (this
 * environment's proxy blocks outbound GraphQL regardless) — every test
 * either calls capability-only tools (gh_preflight with live:false) or
 * injects a fake backend via `makeBackend`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttpServer, parseBearerToken, DEFAULT_HTTP_PATH } from '../lib/http-transport.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const contract = JSON.parse(readFileSync(join(repoRoot, 'contracts/tools.json'), 'utf8'));

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child)]),
  );
}

function expectedProtocolTools() {
  return contract.tools
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: normalize(tool.inputSchema),
      ...(tool.outputSchema ? { outputSchema: normalize(tool.outputSchema) } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function actualProtocolTools(tools) {
  return tools
    .map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: normalize(tool.inputSchema ?? {}),
      ...(tool.outputSchema ? { outputSchema: normalize(tool.outputSchema) } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Start a real HTTP transport server on loopback/an ephemeral port and tear it down after `fn`. */
async function withServer(options, fn) {
  const server = await startHttpServer({ host: '127.0.0.1', port: 0, ...options });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function connectedClient(baseUrl, path, token) {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}${path ?? DEFAULT_HTTP_PATH}`), {
    requestInit: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  });
  const client = new Client({ name: 'gh-projects-http-test', version: '1.0.0' });
  return { client, transport };
}

// ── parseBearerToken (pure) ─────────────────────────────────────────────────

test('parseBearerToken accepts a well-formed header and rejects everything else', () => {
  assert.equal(parseBearerToken('Bearer abc123'), 'abc123');
  assert.equal(parseBearerToken('bearer abc123'), 'abc123'); // scheme is case-insensitive
  assert.equal(parseBearerToken('Bearer   abc123  '), 'abc123');
  assert.equal(parseBearerToken('Bearer '), null);
  assert.equal(parseBearerToken('Bearer'), null);
  assert.equal(parseBearerToken('Token abc123'), null);
  assert.equal(parseBearerToken(''), null);
  assert.equal(parseBearerToken(undefined), null);
  assert.equal(parseBearerToken(null), null);
});

// ── auth/identity boundary ──────────────────────────────────────────────────

test('POST /mcp with no Authorization header is rejected with 401 before any MCP work', async () => {
  await withServer({}, async (baseUrl) => {
    const res = await fetch(`${baseUrl}${DEFAULT_HTTP_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.match(body.error.message, /Authorization/);
  });
});

test('POST /mcp with a malformed Authorization header (wrong scheme) is rejected with 401', async () => {
  await withServer({}, async (baseUrl) => {
    const res = await fetch(`${baseUrl}${DEFAULT_HTTP_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Token not-a-bearer-scheme' },
      body: '{}',
    });
    assert.equal(res.status, 401);
  });
});

test('POST /mcp with an empty Bearer token is rejected with 401', async () => {
  await withServer({}, async (baseUrl) => {
    const res = await fetch(`${baseUrl}${DEFAULT_HTTP_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' },
      body: '{}',
    });
    assert.equal(res.status, 401);
  });
});

test('GET and DELETE /mcp are rejected — this stateless transport only accepts POST', async () => {
  await withServer({}, async (baseUrl) => {
    const getRes = await fetch(`${baseUrl}${DEFAULT_HTTP_PATH}`, { method: 'GET', headers: { Authorization: 'Bearer t' } });
    assert.equal(getRes.status, 405);
    const deleteRes = await fetch(`${baseUrl}${DEFAULT_HTTP_PATH}`, { method: 'DELETE', headers: { Authorization: 'Bearer t' } });
    assert.equal(deleteRes.status, 405);
  });
});

test('an unknown path 404s', async () => {
  await withServer({}, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/not-mcp`, { method: 'POST', headers: { Authorization: 'Bearer t' } });
    assert.equal(res.status, 404);
  });
});

test('GET /healthz needs no auth and reports the http transport', async () => {
  await withServer({}, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/healthz`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { status: 'ok', transport: 'http' });
  });
});

test('a valid bearer token is accepted: the client can connect and list tools', async () => {
  await withServer({}, async (baseUrl) => {
    const { client, transport } = connectedClient(baseUrl, undefined, 'valid-test-token');
    try {
      await client.connect(transport);
      const response = await client.listTools();
      assert.ok(response.tools.length > 0);
    } finally {
      await client.close();
    }
  });
});

test('requireAuth:false falls back to the process-wide backend (documented single-tenant escape hatch)', async () => {
  await withServer({ requireAuth: false }, async (baseUrl) => {
    const { client, transport } = connectedClient(baseUrl, undefined, undefined);
    try {
      await client.connect(transport);
      const response = await client.listTools();
      assert.ok(response.tools.length > 0);
    } finally {
      await client.close();
    }
  });
});

test('concurrent requests with different bearer tokens each see only their own backend (per-request identity isolation)', async () => {
  function fakeAuthBackend(token) {
    return {
      kind: 'test-fake',
      gh: (...args) => {
        if (args[0] === 'auth' && args[1] === 'status') {
          return { stdout: JSON.stringify({ authenticatedAs: token }), stderr: '', status: 0 };
        }
        throw new Error(`unexpected gh ${args.join(' ')}`);
      },
      gql: () => { throw new Error('unexpected gql call'); },
      capabilities: () => ({ backend: 'test-fake' }),
    };
  }

  await withServer({ makeBackend: (token) => fakeAuthBackend(token) }, async (baseUrl) => {
    async function callAuthStatus(token) {
      const { client, transport } = connectedClient(baseUrl, undefined, token);
      try {
        await client.connect(transport);
        const result = await client.callTool({ name: 'gh_auth_status', arguments: {} });
        return JSON.parse(result.content[0].text).authenticatedAs;
      } finally {
        await client.close();
      }
    }

    const [a, b] = await Promise.all([
      callAuthStatus('token-identity-a'),
      callAuthStatus('token-identity-b'),
    ]);
    assert.equal(a, 'token-identity-a');
    assert.equal(b, 'token-identity-b');
  });
});

// ── gh_preflight transport reporting (#64 capability model) ────────────────

test('gh_preflight reports transport:"http" when running under the HTTP transport', async () => {
  await withServer({}, async (baseUrl) => {
    const { client, transport } = connectedClient(baseUrl, undefined, 'preflight-test-token');
    try {
      await client.connect(transport);
      const result = await client.callTool({ name: 'gh_preflight', arguments: {} });
      const report = JSON.parse(result.content[0].text);
      assert.equal(report.transport, 'http');
      assert.equal(report.backend, 'github-api');
      // Never touches the network by default (live:false) — this environment's
      // proxy blocks outbound GraphQL regardless, so this must not hang/fail.
      assert.equal(report.details.live, false);
    } finally {
      await client.close();
    }
  });
});

// ── #63 remote-transport contract parity ────────────────────────────────────

test('HTTP transport tools/list matches contracts/tools.json exactly (extends #63 parity to the remote transport)', async () => {
  await withServer({}, async (baseUrl) => {
    const { client, transport } = connectedClient(baseUrl, undefined, 'contract-test-placeholder');
    try {
      await client.connect(transport);
      const response = await client.listTools();
      const actual = actualProtocolTools(response.tools);
      const expected = expectedProtocolTools();
      assert.equal(actual.length, expected.length);
      assert.equal(JSON.stringify(actual), JSON.stringify(expected));
    } finally {
      await client.close();
    }
  });
});
