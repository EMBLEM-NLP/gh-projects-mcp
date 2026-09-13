# Remote HTTP deployment (#60)

`gh-projects-mcp` ships two transports that connect the *same* `McpServer` (identical tool
registrations, same confirm-gated destructive semantics, same GitHub state changes — see
`lib/server-factory.mjs`'s `createMcpServer()`):

- **stdio** (`server.mjs`) — for Claude Code, Codex CLI/Desktop, and any MCP client that can launch a
  local subprocess. See `docs/CODEX.md`.
- **remote HTTP** (`server-http.mjs`) — for hosted Codex, ChatGPT custom apps/connectors, and any
  other MCP client that talks the MCP SDK's Streamable HTTP transport over the network instead of
  launching a subprocess. This document covers that path.

This repository implements, unit/integration-tests (bound to `127.0.0.1` on an ephemeral port — see
`test/http-transport.test.mjs`), and documents the HTTP transport. **It does not provision, deploy, or
operate any publicly reachable instance** — standing up real infrastructure (which container host,
which domain, which TLS certificate, which secret manager) is a decision for whoever operates a given
deployment, not something this repository does on its own.

## Before you deploy: read the identity model

The HTTP transport requires a per-request `Authorization: Bearer <token>` by default — each request's
token becomes that request's own, isolated GitHub identity (a fresh `GitHubApiBackend`, discarded
after the request). This is the important design decision behind this transport; read
[`docs/BACKENDS.md`'s "Backend identity over the remote HTTP transport"](BACKENDS.md#backend-identity-over-the-remote-http-transport-60)
before choosing how callers authenticate, including the v1 limits it documents (no per-caller
scoping beyond the token's own GitHub permissions, no session concept, no `gh-cli` backend over this
transport).

## Running it

```sh
npm ci
npm run start:http
# gh-projects-mcp HTTP transport listening on http://127.0.0.1:3000/mcp (health check: http://127.0.0.1:3000/healthz)
```

Or directly: `node server-http.mjs`. The process binds `127.0.0.1` by default — intentionally
loopback-only, so it is never accidentally exposed without a reverse proxy in front of it (see
"Putting it behind a reverse proxy" below).

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `GH_PROJECTS_HTTP_PORT` (or `PORT`) | `3000` | TCP port to listen on. |
| `GH_PROJECTS_HTTP_HOST` | `127.0.0.1` | Bind address. Only change this once a reverse proxy/load balancer is the actual public-facing listener — see below. |
| `GH_PROJECTS_HTTP_PATH` | `/mcp` | The MCP endpoint path. `GET /healthz` is always available alongside it, unauthenticated. |
| `GH_PROJECTS_HTTP_REQUIRE_AUTH` | unset (auth required) | Set to `false` or `0` to disable the per-request bearer-token requirement — a documented, single-tenant-only escape hatch. See `docs/BACKENDS.md`. Never set this on a deployment reachable by more than one trusted caller. |
| `GH_PROJECTS_API_URL` / `GH_PROJECTS_GRAPHQL_URL` | github.com | Same GitHub Enterprise Server endpoint overrides the stdio path already supports (`docs/BACKENDS.md`), applied to every per-request backend. |
| `GH_PROJECTS_TOKEN` / `GITHUB_TOKEN` | unset | Only consulted when `GH_PROJECTS_HTTP_REQUIRE_AUTH=false` (the single-tenant escape hatch) — otherwise every request supplies its own token and these are unused by the HTTP transport. |

`GH_PROJECTS_BACKEND` (`gh-cli` vs `api`) is a stdio-only concept — the HTTP transport always uses the
direct GitHub API backend, per request; there is no local `gh` CLI identity to shell out to remotely.

### Health check

`GET /healthz` returns `{"status":"ok","transport":"http"}` and requires no authentication — point a
container platform's liveness/readiness probe at it. It never touches GitHub and never reflects a
caller's own credential state; call `gh_preflight` (an authenticated MCP tool call) for that.

## Container deployment

A minimal container image — build your own from this shape, adjusted to your base-image and registry
policies:

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server-http.mjs ./
COPY lib ./lib
EXPOSE 3000
ENV GH_PROJECTS_HTTP_HOST=0.0.0.0
CMD ["node", "server-http.mjs"]
```

Notes:

- `GH_PROJECTS_HTTP_HOST=0.0.0.0` is set here because inside a container the loopback-only default
  would make the service unreachable from outside the container network namespace — the container
  runtime/orchestrator's own network boundary (not this process) is what should keep it off the public
  internet directly; see "Putting it behind a reverse proxy" below for the piece that actually should
  terminate public traffic.
- `playwright` is a `dependencies` entry in `package.json` (used only by the browser-ui fallback,
  which is `unavailable` on any non-`win32` platform — see `docs/CAPABILITIES.md`) but is not imported
  anywhere reachable from the HTTP transport's request path; omitting its browser binaries from the
  image is safe. `npm ci --omit=dev` still installs the `playwright` npm package itself (a
  `dependencies`, not `devDependencies`, entry) but never downloads a browser binary unless something
  calls `playwright install`, which nothing here does.
- This repository does not publish a container image or Dockerfile of its own; the block above is
  documentation of a working shape, not a maintained artifact.

## Putting it behind a reverse proxy

`server-http.mjs` speaks plain HTTP and does not terminate TLS itself. A real deployment needs a
reverse proxy or load balancer in front of it that:

- terminates TLS (this process never sees a raw client certificate or handles TLS directly);
- forwards `POST <path>` (default `/mcp`) and `GET /healthz` to this process's port;
- passes the `Authorization` header through unmodified (do **not** strip, rewrite, or inject it at
  the proxy — the whole per-request identity model depends on the original caller's token reaching
  this process untouched);
- optionally enforces its own coarser access control (IP allowlisting, mTLS, a WAF rule) — this
  process does not do network-level access control, only the bearer-token check described above.

A minimal illustrative nginx `location` block:

```nginx
location /mcp {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Authorization $http_authorization;
    proxy_http_version 1.1;
    proxy_buffering off; # Streamable HTTP may use a server-sent-events response stream
}
location /healthz {
    proxy_pass http://127.0.0.1:3000;
}
```

## Supported MCP clients

The HTTP transport implements the MCP SDK's standard `StreamableHTTPServerTransport` — any spec-compliant
Streamable HTTP MCP client can connect to it, exactly as `test/http-transport.test.mjs` does using the
SDK's own `StreamableHTTPClientTransport`. In particular:

- **Hosted Codex** and other server-side Codex deployments that cannot launch a local subprocess.
- **ChatGPT custom connectors/apps** configured to reach an MCP server over HTTP with a bearer token.
- Any other remote MCP client that supports adding an HTTP MCP server with a custom `Authorization`
  header.

**Claude Code Remote (CCR) is explicitly not covered by this document.** Landing this transport makes
a working, tested remote MCP endpoint *exist* in this repository, but CCR's own product surface would
still need to know how to register a remote HTTP MCP server and allow-list this endpoint through its
own egress proxy before any CCR session could actually reach it — that is a CCR product change, not
something this repository controls, and is out of scope here (see issue #60's own "Context on why
this matters" section).

## Logging

Every request to the HTTP transport is logged as one structured JSON line to stderr
(`lib/request-log.mjs`'s `logEvent`) — `event`, a `requestId`, `transport`, HTTP `method`/`path`,
`status`, and `durationMs`, plus (for `/mcp` requests) whether the request carried a token
(`authenticated: true/false`) and, on rejection, a non-secret `reason` string
(`missing_or_malformed_bearer_token`, or an error message). **The token value itself, any other
request header, and the request/response body (which can carry project/issue titles and body text)
are never logged.** Pipe stderr to whatever your platform's log aggregator expects; this server does
not write log files or manage log rotation itself.

## Operational checklist

- [ ] TLS is terminated by a reverse proxy/load balancer in front of this process, not by this
      process itself.
- [ ] This process is not directly reachable from the public internet — only through the proxy above,
      or (for a genuinely private/internal deployment) a private network.
- [ ] `GH_PROJECTS_HTTP_REQUIRE_AUTH` is **not** set to `false` unless this is a deliberately
      single-tenant deployment behind its own access control (see `docs/BACKENDS.md`).
- [ ] Callers are issued GitHub tokens scoped to only what they need (fine-grained PATs or GitHub App
      installation tokens), since this server does not add its own authorization layer on top of
      whatever the bearer token can already do on GitHub.
- [ ] The container platform's liveness/readiness probe targets `GET /healthz`.
- [ ] Log output (stderr) reaches your log aggregation, and nothing downstream re-adds request bodies
      or headers to those log lines.
