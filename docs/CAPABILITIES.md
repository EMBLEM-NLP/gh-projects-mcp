# Runtime capability / preflight model

`gh-projects-mcp` runs in several very different runtimes — a developer's Windows desktop, a Codex
sandbox with no display, a hosted/containerized agent, and (via the remote HTTP transport, #60) a
shared remote deployment serving many callers. Most of the server's tools are pure GitHub
REST/GraphQL calls and work identically everywhere a backend is configured. A small number of tools
(`gh_project_workflow_autoadd_configure`, and the optional `groupBy` input on
`gh_project_view_create`/`gh_project_view_edit`) still depend on attaching to a locally running,
already-logged-in Microsoft Edge over the Chrome DevTools Protocol (CDP) via Playwright — see
`lib/cdp.mjs`, `lib/view-groupby-ui.mjs`, `lib/tools-workflows.mjs`.

This document describes how the server reports and isolates that split.

## The `gh_preflight` tool

Call `gh_preflight` (optionally `{ "live": true }`) to get a structured capability report instead of
guessing from error text:

```json
{
  "transport": "stdio",
  "backend": "github-api",
  "rest": "ready",
  "graphql": "ready",
  "projectsRead": "ready",
  "projectsWrite": "ready",
  "issuePr": "ready",
  "browserUi": "unavailable",
  "details": {
    "backend": { "directApi": true, "requiresGhCli": false, "note": "..." },
    "browserUi": { "reason": "the browser-ui fallback (Edge/CDP) is a Windows-desktop capability; unsupported on platform \"linux\"" },
    "live": false
  }
}
```

Each of `rest`/`graphql`/`projectsRead`/`projectsWrite`/`issuePr`/`browserUi` is one of:

- `"ready"` — usable now (or, in a live probe, was just used successfully).
- `"unavailable"` — will not work in this process; calling a tool that needs it fails closed with a
  `capability_unavailable: ...` error rather than a confusing lower-level failure.
- `"unknown"` — plausible but not yet confirmed (e.g. the `gh-cli` backend's actual reachability, or
  `browserUi` on win32 before a live probe).

By default `gh_preflight` only inspects configuration (selected backend, whether a token is set,
OS platform) — no network calls, no Playwright import, effectively free to call. Pass `live:true` to
additionally attempt one REST call (`gh api user`), one GraphQL call (`viewer { login }`), and — only
when the platform is `win32` — one local CDP reachability probe (still without importing Playwright;
see `lib/cdp.mjs`'s plain `http.get`). **No token value is ever included in the report**, live or not;
error text from a failed live probe is scrubbed of any configured token first
(`lib/runtime-capabilities.mjs`'s `redactSecrets`).

`gh_auth_status` still exists unchanged (raw `gh auth status` passthrough); `gh_preflight` is the
structured successor this issue (#64) asks for and is what tooling/agents should prefer.

## Fail-closed browser-ui isolation

Every browser-ui entry point calls `assertBrowserUiAvailable()`
(`lib/runtime-capabilities.mjs`) **before** doing anything else — before attaching to Edge/CDP and
before the dynamic `import('playwright')` / `import('./view-groupby-ui.mjs')` that would pull in the
browser stack:

- `lib/tools-workflows.mjs`'s `withWorkflowsPage()` (used by `gh_project_workflow_autoadd_configure`)
- `lib/tools-views-graphql.mjs`'s `defaultGroupByPreflight`/`defaultGroupByApply` (used only when a
  view spec includes `groupBy`)

`assertBrowserUiAvailable()` is a pure, no-I/O check: it is `unavailable` whenever
`GH_PROJECTS_DISABLE_BROWSER_UI` is set, or the platform is anything other than `win32` (the Edge/CDP
fallback is a Windows-desktop capability by construction — it attaches to a real, locally running,
signed-in Edge; there is no headless/Linux equivalent). On any such runtime the tool returns
immediately with:

```
capability_unavailable: browser-ui — the browser-ui fallback (Edge/CDP) is a Windows-desktop capability; unsupported on platform "linux"
```

— instead of a multi-second CDP connection timeout, and **Playwright is never imported at all**. This
is what lets `gh-projects-mcp` start and serve every API-backed tool in a container/hosted runtime
that has no Playwright install and no display, which you can verify yourself: remove/rename
`node_modules/playwright` and the server still starts and every non-browser-ui tool still works —
only the browser-ui tools fail closed with the message above.

On `win32`, `assertBrowserUiAvailable()` does not block — the tool proceeds to attempt the real
Edge/CDP attach exactly as before, and fails with its existing (already fail-closed, already
non-destructive — see `lib/cdp.mjs`'s "attach-only" contract) error if Edge isn't reachable/signed in.

Set `GH_PROJECTS_DISABLE_BROWSER_UI=1` to force this off explicitly even on a Windows host — useful
for a Windows-hosted deployment that intentionally has no interactive Edge session.

## Expected capability matrix per runtime

| Runtime | transport | backend | rest / graphql / projects* / issuePr | browserUi |
|---|---|---|---|---|
| **Claude Code / Claude Desktop**, local Windows checkout, `gh` CLI signed in, Edge signed into github.com | `stdio` | `gh-cli` | `unknown` until live-probed (or a tool is called) — then `ready` | `unknown` until a browser-ui tool runs or `live:true` probes it — then `ready` if Edge/CDP is reachable |
| **Claude Code / Claude Desktop**, local Windows checkout, `GH_PROJECTS_TOKEN` set (direct API mode) | `stdio` | `github-api` | `ready` | same as above (independent of backend choice) |
| **Codex CLI/Desktop**, local checkout, any OS, `GH_PROJECTS_TOKEN` set | `stdio` | `github-api` | `ready` | `unavailable` on macOS/Linux; same as the Claude row above on Windows |
| **Codex CLI/Desktop**, local checkout, no token, `gh` CLI signed in | `stdio` | `gh-cli` | `unknown`/`ready` per live probe | `unavailable` on macOS/Linux |
| **Hosted Codex** (containerized, no desktop, no `gh` CLI) | `stdio` | `github-api` (token must be provided — `gh-cli` mode cannot work without a local `gh` binary) | `ready` once a token is configured, else `unavailable` | `unavailable` — every browser-ui tool call returns `capability_unavailable` immediately |
| **Remote HTTP deployment** (`server-http.mjs`, #60) | `http` | `github-api` — every request supplies its own `Authorization: Bearer <token>` and gets a fresh, per-request backend (see docs/BACKENDS.md); the `gh-cli` backend is not reachable over this transport at all | `ready` once the caller's bearer token is valid; `unavailable` if the request had no/an invalid token (rejected with HTTP 401 before reaching any tool) | `unavailable` — no desktop Edge exists in that process either |
| **CI** (this repo's own GitHub Actions, `ubuntu-latest`) | `stdio` | both `gh-cli` and `github-api` are exercised for contract parity (see `scripts/tool-contract.mjs`) | `github-api` row is `ready` with a placeholder/real token per job; `gh-cli` row is whatever the runner's `gh` auth state is | `unavailable` (Linux) |

`*` "projects" here stands for both `projectsRead` and `projectsWrite`, which currently move together
with `graphql` (Projects v2 is a GraphQL-only API) — see `lib/runtime-capabilities.mjs`'s
`detectBackendConfig`/`detectRuntimeCapabilities` for the exact derivation, including how a `live:true`
probe can turn each of `rest`/`graphql` (and therefore `issuePr`/`projectsRead`/`projectsWrite`)
independently `ready` or `unavailable`.

## Remote HTTP transport (#60)

`server-http.mjs` connects the exact same `McpServer` (`lib/server-factory.mjs`'s `createMcpServer()`
— identical tool registrations to stdio) to the MCP SDK's `StreamableHTTPServerTransport` instead of
`StdioServerTransport`. It reports through this same capability model rather than a parallel one:
`createMcpServer({ transport: 'http' })` threads the label into `registerPreflightTool`, so
`gh_preflight` called over the HTTP transport reports `"transport": "http"` with no other change to
the report's shape.

What is different about the HTTP transport is backend *identity*, not the capability model itself:

- Every request must carry `Authorization: Bearer <token>`; a missing/malformed header is rejected
  with HTTP 401 before any MCP protocol or GitHub work happens.
- That token becomes a **per-request** `GitHubApiBackend` (`lib/github-backend.mjs`), scoped to the
  single request via `lib/request-context.mjs`'s `AsyncLocalStorage`-based `withRequestBackend` — it
  is never stored, logged, or reused across requests, and concurrent requests on the same process
  never see each other's backend (see `test/request-scoped-backend.test.mjs` and
  `test/http-transport.test.mjs` for the isolation proof).
- The `gh-cli` backend cannot be selected over this transport at all: a remote/shared process has no
  single local, already-authenticated `gh` identity that would be safe to serve every caller with.
- `GH_PROJECTS_HTTP_REQUIRE_AUTH=false` is a documented, explicit single-tenant escape hatch: every
  request instead shares the one process-wide, env-configured backend (identical to the stdio
  behavior). This is never the default and is only appropriate behind an operator's own
  authenticating reverse proxy — see `docs/BACKENDS.md` and `docs/DEPLOYMENT.md`.

See `docs/DEPLOYMENT.md` for the deployment model and `docs/BACKENDS.md` for the full per-request
bearer-token design writeup, including its multi-tenant limits.

## What this repository does NOT implement

- **A `mock` backend kind** is mentioned as a possible `backend` value in the #64 issue's own example
  list but is not implemented — `lib/runtime-capabilities.mjs`'s `detectBackendConfig` already
  degrades any unrecognized backend kind (present or future, including a later `mock` backend) to
  `"unknown"` rather than throwing, so adding one later needs no capability-model change.
- **Public hosting of the HTTP transport.** This repository implements, unit/integration-tests
  (bound to `127.0.0.1` on an ephemeral port), and documents the transport; it does not provision or
  operate any publicly reachable server. That deployment decision belongs to whoever operates a given
  instance.
