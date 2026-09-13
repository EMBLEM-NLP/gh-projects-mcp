# GitHub backend modes

`gh-projects-mcp` is migrating from a mandatory local `gh` CLI dependency to a backend-neutral architecture.

## Selection

Set `GH_PROJECTS_BACKEND` to one of:

- `auto` (default): use the direct API backend when `GH_PROJECTS_TOKEN` or `GITHUB_TOKEN` is present; otherwise use the local `gh` CLI backend.
- `gh-cli`: always use the existing authenticated `gh` CLI path.
- `api`: use GitHub REST/GraphQL directly and require `GH_PROJECTS_TOKEN` or `GITHUB_TOKEN`.

Optional endpoint overrides:

- `GH_PROJECTS_API_URL`
- `GH_PROJECTS_GRAPHQL_URL`

Backend selection is one input to the broader runtime capability model — call `gh_preflight` to see
how it, plus the OS platform and any configured token, map to REST/GraphQL/Projects/issue-PR/
browser-ui readiness. See [docs/CAPABILITIES.md](CAPABILITIES.md) (#64).

The direct API backend sends credentials only in the Authorization header and never includes them in command-line arguments.

## Current migration slice

The API backend currently provides direct support for:

### Shared GraphQL / auth

- GraphQL calls made through the shared `gql()` helper.
- `gh auth status` compatibility.
- owner type lookup (`gh api users/<owner> --jq .type`).

### Projects

- `gh project list`.
- `gh project view`.
- `gh project delete`, including a post-mutation absence check.

### Issues and labels

- `gh issue create`, including body-file loading, repeated labels, and milestone-title resolution.
- `gh issue list`, including pagination, PR filtering, and GraphQL node IDs required by sub-issue tools.
- `gh label list`.
- `gh label create`.

### Pull requests

- `gh pr create`.
- `gh pr list` with the same normalized fields used by the MCP (`number`, `title`, `url`, `state`, head/base refs, mergeability, draft flag).
- `gh pr merge` using GitHub's merge API. Same-repository branch cleanup is attempted after a successful merge; cleanup failure is reported separately so callers do not retry an already-completed merge.

Other high-level `gh` commands fail closed with `capability_unavailable` while they are migrated. This is deliberate: the server must never silently fall back to a different authenticated identity.

The `gh-cli` backend remains the complete compatibility path during the migration.

## Why the API backend is synchronous for now

Most existing tool handlers use synchronous `gh()` / `gql()` helpers. To preserve those public tool contracts while the backend boundary is introduced, direct API requests run through a short-lived Node request runner. This removes the external `gh` binary requirement for migrated operations without forcing a flag-day rewrite of every handler.

A later refactor may make the internal backend interface fully async once all handlers are dependency-injected.

## Security / identity rules

- Prefer GitHub App installation tokens for hosted deployments.
- `GH_PROJECTS_TOKEN` takes precedence over `GITHUB_TOKEN`.
- `GH_PROJECTS_BACKEND=api` never falls back to local `gh` authentication.
- Unsupported API-backend operations return `capability_unavailable`; they do not invoke a different backend.
- A PR merge and branch cleanup are two distinct outcomes. Once GitHub reports the PR merged, failure to delete the branch is surfaced as cleanup status rather than a merge failure.

## Backend identity over the remote HTTP transport (#60)

The stdio transport is one process per client, so a single backend selected once from env at startup
(everything above this section) is the right model: one identity for the life of the process, chosen
by whoever launched it. `server-http.mjs` is different — one process can serve many concurrent remote
callers — so it needed its own answer to "whose GitHub identity does a given request use?" The issue
that tracked this (#60) named two options and asked for the choice to be documented rather than
assumed:

- **(a) single server-side token from env.** Simplest; matches "remote deployments must not require
  interactive `gh auth`" literally; fine for a single-tenant/internal deployment where every caller is
  already trusted to act as the same GitHub identity.
- **(b) per-request `Authorization: Bearer <token>`, a fresh backend built from it per request.**
  Needed for genuine multi-tenant remote use, and the only choice that makes "request
  identity/authorization boundaries explicit for owner/org/repo/project operations" (the issue's own
  requirement) actually true rather than aspirational.

**This implementation chooses (b) as the default**, and treats (a) as an explicit, opt-in escape
hatch (`GH_PROJECTS_HTTP_REQUIRE_AUTH=false`) rather than the default — for three reasons specific to
what this codebase already supports cleanly:

1. GitHub REST/GraphQL credentials are already just a bearer token
   (`GitHubApiBackend`'s `Authorization: Bearer ${this.token}` header) — accepting the *caller's*
   token instead of a server-configured one is a direct, natural fit, not a new auth model bolted on.
2. The one thing that made per-request identity previously impractical was architectural, not
   conceptual: every tool handler calls the module-level `gh()`/`gql()` exported by `lib/gql.mjs`,
   which read one module-level `backend` variable selected once at process start. Rather than thread a
   `backend` parameter through all ~45 handlers (a much larger, riskier change touching every tool),
   `lib/request-context.mjs` adds one `AsyncLocalStorage`-scoped override that `lib/gql.mjs`'s
   `gh()`/`gql()`/`backendCapabilities()` check first. `server-http.mjs` wraps each request's handling
   in `withRequestBackend(backend, …)` with a `GitHubApiBackend` built from that request's token. No
   tool handler changed. See `test/request-scoped-backend.test.mjs` for the isolation proof and
   `test/http-transport.test.mjs`'s "concurrent requests with different bearer tokens" test for the
   same guarantee exercised through a real HTTP server.
3. It matches how the `gh-cli` backend was already excluded from any hosted/remote runtime in
   `docs/CAPABILITIES.md`'s matrix (no local `gh` identity exists in a container) — extending that same
   boundary to "no single shared GitHub identity either" is the smaller, more consistent step.

### What this does NOT provide (v1 limits — documented, not silently assumed)

- **No token scoping/allowlisting by this server.** Whatever the bearer token can do on GitHub, the
  request can do — access control is entirely GitHub's own (the token's scopes/installation
  permissions), not layered by `gh-projects-mcp`. An operator who needs per-caller restriction beyond
  what the token itself grants (e.g. "this caller may only touch project #4") needs to mint
  differently-scoped tokens/GitHub App installations per caller and hand out the right one — this
  server does not police that.
- **No session/connection identity beyond the token.** The transport is stateless
  (`sessionIdGenerator: undefined` — a fresh `McpServer` + transport pair per HTTP request; see
  `lib/http-transport.mjs`), so there is no concept of a logged-in "user" independent of the header
  on each individual request. Every request stands alone.
- **No token persistence, caching, or reuse across requests.** A `GitHubApiBackend` is constructed
  fresh per request and discarded after; there is no token cache, so there is also no reduced-latency
  benefit from token reuse (each request that hits GitHub pays its own request-runner subprocess cost
  the same as stdio already does — see "Why the API backend is synchronous for now" above).
- **No `gh-cli` backend over HTTP.** Only `github-api` is reachable through this transport, by
  construction (the whole point is not depending on a local, already-authenticated `gh` process).
- **The `GH_PROJECTS_HTTP_REQUIRE_AUTH=false` escape hatch is single-tenant only.** With it set, every
  request shares one process-wide backend built from `GH_PROJECTS_TOKEN`/`GITHUB_TOKEN` in the
  process's own env (identical to stdio's env-selected backend) — appropriate only when an operator
  has already restricted who can reach this process at all (e.g. a private network, or their own
  authenticating reverse proxy in front of it) and every caller is meant to act as the same identity.
  It is never the default and this server does not warn callers that auth is off.
