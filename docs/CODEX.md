# Codex integration

`gh-projects-mcp` uses the same MCP server and canonical skill in Claude and Codex. There is no Codex-specific business-logic fork.

## Packaged surfaces

- `.codex-plugin/plugin.json` — Codex plugin manifest.
- `.mcp.json` — local stdio MCP declaration.
- `skills/gh-project-manage/SKILL.md` — canonical cross-client skill.
- `server.mjs` — the same MCP server used by Claude.
- `contracts/tools.json` — canonical protocol contract enforced in CI.

The Codex MCP declaration uses `cwd: "."`. Current Codex resolves a plugin-provided relative `cwd` against the installed plugin root, so `args: ["server.mjs"]` does not require an installation-specific absolute path.

## Local source-checkout setup

Codex plugins currently do not have a general runtime dependency-install lifecycle. This repository therefore treats a source checkout as the supported local-development path until #60 provides a remotely hosted/self-contained deployment.

From the checkout:

```sh
npm ci
```

Then install/import the repository as a local Codex plugin using your available Codex plugin/marketplace flow. The plugin contributes an MCP server named `gh-projects`.

You can inspect MCP registration with current Codex CLI tooling such as:

```sh
codex mcp list
codex mcp get gh-projects --json
```

The exact plugin installation UI/command can vary by Codex surface/workspace; the repository package itself follows the current `.codex-plugin/plugin.json` + `.mcp.json` format.

## Authentication/backend choices

The plugin whitelists these environment variables into its stdio MCP process:

- `GH_PROJECTS_BACKEND`
- `GH_PROJECTS_TOKEN`
- `GITHUB_TOKEN`
- `GH_PROJECTS_API_URL`
- `GH_PROJECTS_GRAPHQL_URL`

### Direct API mode — preferred for portable Codex use

Set a GitHub token in the environment used to launch Codex:

```sh
export GH_PROJECTS_BACKEND=api
export GH_PROJECTS_TOKEN=...
```

`GITHUB_TOKEN` is accepted as a fallback. `GH_PROJECTS_TOKEN` takes precedence.

Direct API mode does not require a local `gh` binary for migrated operations.

### Local gh CLI mode

If no API token is present, the default `auto` backend can use the existing authenticated `gh` CLI path. You can force it with:

```sh
export GH_PROJECTS_BACKEND=gh-cli
```

Do not configure both modes as separate MCP servers for the same workflow; use one explicit identity/backend so mutations cannot silently land under the wrong account.

## Manual MCP fallback

If you do not install the Codex plugin, configure the same source checkout as a local stdio MCP using Codex's MCP configuration with:

- command: `node`
- args: `server.mjs`
- cwd: the absolute path to this checkout
- env vars: the backend/auth names listed above

The plugin and manual paths must expose the same `tools/list` contract.

## Verification

Repository CI verifies:

1. `gh-cli` and `github-api` backend modes expose the same MCP tools.
2. `contracts/tools.json` matches the live server.
3. Claude and Codex package versions match `package.json`.
4. Both client packages use the canonical shared skill.
5. The Codex `.mcp.json` launch declaration points at the same `server.mjs`.

## Browser-only capability

Normal Project view create/edit/delete is GraphQL-backed and works in the same API/CLI runtimes as other Project operations. The contract marks `gh_project_view_create` and `gh_project_view_edit` with an optional `browser-ui:groupBy` capability because only the `groupBy` input still requires the logged-in Edge/CDP fallback. `gh_project_view_delete` is fully API-backed.

Remote/hosted Codex runtimes do not expose a browser. Calling `gh_project_workflow_autoadd_configure`, or requesting `groupBy` on `gh_project_view_create`/`gh_project_view_edit`, in such a runtime fails immediately with a structured `capability_unavailable: browser-ui — ...` error — Playwright is never imported and no multi-second connection attempt happens first. Every other API-backed view setting still works normally; only `groupBy` needs to wait for a non-browser mutation to exist upstream. Call `gh_preflight` to check `browserUi` (and every other capability) up front instead of discovering this from a tool error. See [docs/CAPABILITIES.md](CAPABILITIES.md) for the full runtime capability model and expected matrix per client (#64).

## Remote/hosted Codex

Remote MCP transport and a deployment model that does not rely on a local source checkout are tracked in #60. That work must reuse the same server/domain implementation and pass the same `contracts/tools.json` parity gate, and should report `transport: "http"` through the same `gh_preflight` capability model introduced in #64 (see [docs/CAPABILITIES.md](CAPABILITIES.md)) rather than a new one.
