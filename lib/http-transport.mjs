/**
 * Remote HTTP MCP transport (#60).
 *
 * Reuses `lib/server-factory.mjs`'s `createMcpServer()` — the exact same
 * tool/domain registrations the stdio transport uses — connected to the
 * MCP SDK's official `StreamableHTTPServerTransport` instead of
 * `StdioServerTransport`. No remote-only tool implementation exists.
 *
 * Design decision (see docs/BACKENDS.md and docs/CAPABILITIES.md for the
 * full writeup): every request must carry `Authorization: Bearer <token>`.
 * That token is used to build a *per-request* `GitHubApiBackend` — never a
 * shared server-side identity — so multiple callers can share one deployed
 * process without any request seeing another's GitHub identity or being
 * able to act with elevated access it wasn't handed. A missing/malformed
 * header is rejected with 401 before any MCP protocol or GitHub work
 * happens. `requireAuth: false` remains as an explicit, documented
 * single-tenant escape hatch (the env-configured backend, same as stdio,
 * services every request) for an operator who has already put this behind
 * their own authenticating reverse proxy — never the default.
 *
 * Stateless-per-request server/transport pairing follows the MCP SDK's own
 * documented pattern for stateless Streamable HTTP (see the SDK's bundled
 * `examples/server/simpleStatelessStreamableHttp`): a `StreamableHTTPServerTransport`
 * constructed with `sessionIdGenerator: undefined` accepts exactly one
 * request before refusing further ones, so a fresh server+transport pair is
 * built per HTTP request rather than reused. Combined with
 * `withRequestBackend` (lib/request-context.mjs) this also gives clean
 * per-request identity isolation: nothing about one request's server,
 * transport, or backend survives to influence the next.
 */
import { createServer as createNodeHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server-factory.mjs';
import { GitHubApiBackend } from './github-backend.mjs';
import { withRequestBackend } from './request-context.mjs';
import { logEvent } from './request-log.mjs';

export const DEFAULT_HTTP_PATH = '/mcp';
export const DEFAULT_HTTP_PORT = 3000;
export const DEFAULT_HTTP_HOST = '127.0.0.1';

const BEARER_RE = /^Bearer\s+(\S.*)$/i;

/**
 * Parse an `Authorization` header value into a bearer token, or `null` when
 * missing, not a Bearer scheme, or an empty token. Pure/no I/O — safe to
 * unit test directly.
 */
export function parseBearerToken(headerValue) {
  if (typeof headerValue !== 'string') return null;
  const match = headerValue.match(BEARER_RE);
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

function sendJsonRpcError(res, status, message) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
}

/**
 * Build the Node `http` request listener for the remote MCP transport.
 * Exported (rather than only `startHttpServer`) so tests can drive it
 * directly against an in-process `http.Server` bound to `127.0.0.1:0`.
 *
 * @param {object} [options]
 * @param {string} [options.path] MCP endpoint path. Default "/mcp".
 * @param {string} [options.apiUrl] Forwarded to `GitHubApiBackend`.
 * @param {string} [options.graphqlUrl] Forwarded to `GitHubApiBackend`.
 * @param {boolean} [options.requireAuth] Default true — see the module
 *   doc comment for why false is an explicit, documented single-tenant
 *   escape hatch rather than the default.
 * @param {(fields: object) => void} [options.log] Injectable for tests;
 *   defaults to `logEvent` (one JSON line per event, no secrets/body text).
 * @param {(token: string, opts: { apiUrl?: string, graphqlUrl?: string }) => object} [options.makeBackend]
 *   Injectable for tests; defaults to constructing a real `GitHubApiBackend`.
 */
export function createRequestListener({
  path = process.env.GH_PROJECTS_HTTP_PATH || DEFAULT_HTTP_PATH,
  apiUrl = process.env.GH_PROJECTS_API_URL,
  graphqlUrl = process.env.GH_PROJECTS_GRAPHQL_URL,
  requireAuth = !['false', '0'].includes(process.env.GH_PROJECTS_HTTP_REQUIRE_AUTH),
  log = logEvent,
  makeBackend = (token, opts) => new GitHubApiBackend({
    token,
    ...(opts.apiUrl ? { apiUrl: opts.apiUrl } : {}),
    ...(opts.graphqlUrl ? { graphqlUrl: opts.graphqlUrl } : {}),
  }),
} = {}) {
  return async function requestListener(req, res) {
    const requestId = randomUUID();
    const startedAt = Date.now();
    const method = req.method ?? 'GET';
    const url = req.url ?? '';

    // Logged once per request, however it ends. Only shape/identifiers —
    // never headers (which would include the Authorization value) or body
    // (which could include project/issue content) reach `log`.
    res.once('finish', () => {
      log({
        event: 'http_request', requestId, transport: 'http',
        method, path: url, status: res.statusCode, durationMs: Date.now() - startedAt,
      });
    });

    if (method === 'GET' && url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', transport: 'http' }));
      return;
    }

    if (url !== path) {
      sendJsonRpcError(res, 404, `Not found. This server only serves the MCP endpoint at ${path}.`);
      return;
    }

    if (method !== 'POST') {
      sendJsonRpcError(res, 405, 'Method not allowed. This stateless HTTP MCP endpoint only accepts POST.');
      return;
    }

    const token = parseBearerToken(req.headers.authorization);
    if (requireAuth && !token) {
      log({
        event: 'auth_rejected', requestId, transport: 'http', method, path: url,
        reason: 'missing_or_malformed_bearer_token',
      });
      sendJsonRpcError(res, 401, 'Unauthorized: missing or malformed "Authorization: Bearer <token>" header.');
      return;
    }

    let backend;
    try {
      backend = token ? makeBackend(token, { apiUrl, graphqlUrl }) : undefined;
    } catch (error) {
      log({ event: 'auth_rejected', requestId, transport: 'http', method, path: url, reason: error.message });
      sendJsonRpcError(res, 401, `Unauthorized: ${error.message}`);
      return;
    }

    log({
      event: 'auth_accepted', requestId, transport: 'http', method, path: url,
      authenticated: Boolean(token),
    });

    // Fresh server + fresh stateless transport per request — see the module
    // doc comment. `withRequestBackend` scopes every gh()/gql() call any
    // tool handler makes during this request to this request's backend
    // (lib/request-context.mjs), independent of every other in-flight
    // request on this process.
    const server = createMcpServer({ transport: 'http' });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      transport.close().catch(() => {});
      server.close().catch(() => {});
    };
    res.once('close', cleanup);

    try {
      await server.connect(transport);
      const handle = () => transport.handleRequest(req, res);
      await (backend ? withRequestBackend(backend, handle) : handle());
    } catch (error) {
      log({ event: 'handler_error', requestId, transport: 'http', method, path: url, error: error.message });
      sendJsonRpcError(res, 500, 'Internal server error.');
    }
  };
}

/**
 * Start the remote HTTP MCP transport as a real Node `http.Server`. Binds
 * to `127.0.0.1` by default — intentionally loopback-only; a real
 * deployment puts this behind a reverse proxy/load balancer that
 * terminates TLS and forwards to this port (see docs/DEPLOYMENT.md).
 *
 * Tests and local exploration should bind `host: '127.0.0.1'` and
 * `port: 0` (an ephemeral port) explicitly rather than relying on the
 * default port, and must never pass a non-loopback host.
 *
 * @returns {Promise<import('node:http').Server>}
 */
export function startHttpServer({
  port = Number(process.env.GH_PROJECTS_HTTP_PORT ?? process.env.PORT ?? DEFAULT_HTTP_PORT),
  host = process.env.GH_PROJECTS_HTTP_HOST ?? DEFAULT_HTTP_HOST,
  ...listenerOptions
} = {}) {
  const listener = createRequestListener(listenerOptions);
  const httpServer = createNodeHttpServer(listener);
  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      httpServer.removeListener('error', reject);
      resolve(httpServer);
    });
  });
}
