# gh-projects-mcp

**Version 1.9.0**

MCP server for managing [GitHub Projects v2](https://docs.github.com/en/issues/planning-and-tracking-with-projects) —
fields, items, views, sub-issues, and status updates — from any repo, chat, or editor that speaks MCP
(Claude Code, Claude Desktop, VS Code Copilot, etc.).

Every tool takes `owner`/`repo`/project `number` as explicit parameters. Nothing is hardcoded to one
project, so the same server works across all your GitHub Projects boards without copying scripts
into every repo.

## Why this exists

GitHub Projects has a broad GraphQL/REST API, but client/runtime ergonomics still vary. This server
provides one stable MCP contract over local `gh` CLI auth or direct GitHub API auth and preserves
confirmation gates and ID-resolution rules across Claude, Codex, and remote MCP clients (hosted
Codex, ChatGPT custom apps, etc. — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).

Project view create/update/delete are now GraphQL-backed. The only view setting that still requires
the existing logged-in Edge/CDP fallback is optional `groupBy`, because GitHub's current GraphQL
view mutation input exposes name/layout/filter/ordered visible fields but not group-by fields.

## Tools

Summary below; for the full generated inventory (params, confirm-gated flags, capability
requirements — kept in sync with the committed [`contracts/tools.json`](contracts/tools.json) via
`npm run docs:tools`) see [docs/TOOL_INVENTORY.md](docs/TOOL_INVENTORY.md).

| Tool | What it does |
|---|---|
| `gh_auth_status` | Check `gh` CLI auth + `project` scope |
| `gh_preflight` | Structured runtime capability report (transport/backend/REST/GraphQL/Projects/issue-PR/browser-ui readiness) — see [docs/CAPABILITIES.md](docs/CAPABILITIES.md) |
| `gh_project_list` | List a user/org's projects |
| `gh_project_view` | Full project details: title, fields, views (with layout) |
| `gh_project_create` | Create a new project board |
| `gh_project_edit` | Edit title/description/README/visibility, or close/reopen |
| `gh_project_delete` | Delete a project (confirm-gated) |
| `gh_project_copy` | Copy a project to a new one |
| `gh_project_unlink` | Unlink a project from a repo/team |
| `gh_project_mark_template` | Mark/unmark an org project as a template |
| `gh_project_link` | Link a project to a repo |
| `gh_project_field_list` | List fields + option IDs |
| `gh_project_field_create` | Create TEXT/NUMBER/DATE/SINGLE_SELECT/MULTI_SELECT/ITERATION fields |
| `gh_project_field_option_update` | Safely update SINGLE_SELECT/MULTI_SELECT options with ID preservation |
| `gh_project_iteration_configure` | Configure an ITERATION (sprint) field's iterations |
| `gh_project_field_delete` | Delete a custom field (confirm-gated) |
| `gh_project_item_list` | List items on a board |
| `gh_project_item_add` | Add an issue/PR to a board |
| `gh_project_item_create` | Create a draft-issue item directly on a board |
| `gh_project_draft_edit` | Edit a draft item's title/body |
| `gh_project_draft_convert` | Convert a draft item into a real repo issue |
| `gh_project_item_edit` | Set/clear a field value on an item |
| `gh_project_item_archive` | Archive/unarchive an item |
| `gh_project_item_delete` | Remove an item from the board (confirm-gated) |
| `gh_project_item_move` | Reorder an item's board position |
| `gh_project_views_list` | List views with IDs/filter/layout/visible/grouping configuration |
| `gh_project_view_create` | Declaratively create/reconcile views (GraphQL; optional groupBy UI fallback) |
| `gh_project_view_edit` | Edit one view (GraphQL; optional groupBy UI fallback) |
| `gh_project_view_delete` | Delete a view via GraphQL (confirm-gated) |
| `gh_project_workflow_autoadd_configure` | Configure UI-only Auto-add workflow; omitted filter explicitly clears the saved filter and repo+filter are re-verified |
| `gh_issue_create` | Create an issue |
| `gh_issue_list` | List issues (includes GraphQL node `id`) |
| `gh_issue_edit` | Edit issue title/body/labels or reopen/close; close is confirm-gated |
| `gh_issue_close` | Close an issue with completed/not-planned reason (confirm-gated) |
| `gh_pr_create` | Open a pull request |
| `gh_pr_list` | List pull requests (number, state, head/base, mergeability) |
| `gh_pr_merge` | Merge a pull request (confirm-gated) |
| `gh_label_ensure` | Idempotent label creation |
| `gh_subissue_link` | Link a sub-issue to a parent/epic |
| `gh_subissue_unlink` | Remove a sub-issue link |
| `gh_subissue_reprioritize` | Reorder a sub-issue within its parent |
| `gh_status_update_list` | List a project's status updates |
| `gh_status_update_edit` | Edit a status update |
| `gh_status_update_delete` | Delete a status update (confirm-gated) |
| `gh_status_update_create` | Post a project status update |

## Requirements

- Node.js 18+
- GitHub authentication through either direct API mode (`GH_PROJECTS_TOKEN` / `GITHUB_TOKEN`) or the local [`gh` CLI](https://cli.github.com/) backend with project scope
- Microsoft Edge signed into github.com only when using an explicitly browser-backed capability such as view `groupBy`, `gh_project_workflow_autoadd_configure`, or UI-only Insights tooling — this is a Windows-desktop-only requirement; every other tool works the same in a container/hosted runtime with no browser at all. See [docs/CAPABILITIES.md](docs/CAPABILITIES.md) for the full runtime capability model, the `gh_preflight` tool, and the expected capability matrix per client.

## Install

```bash
npm install
```

## Run

```bash
node server.mjs
```

Or register it as an MCP server, e.g. in Claude Code:

```bash
claude mcp add --scope user gh-projects -- node /path/to/gh-projects-mcp/server.mjs
```

### Remote HTTP transport

For hosted Codex, ChatGPT custom apps, and other remote MCP clients that cannot launch a local
subprocess, run the same server over the MCP SDK's Streamable HTTP transport instead:

```bash
node server-http.mjs
# gh-projects-mcp HTTP transport listening on http://127.0.0.1:3000/mcp (health check: http://127.0.0.1:3000/healthz)
```

It reuses the exact same tool registrations as `server.mjs` and requires a per-request
`Authorization: Bearer <token>` by default. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the
deployment model (container, reverse proxy, supported clients) and
[docs/BACKENDS.md](docs/BACKENDS.md) for the per-request identity design.

## Bundled Skill + subagent

This repo also ships the judgment layer that sits on top of the MCP tools:

- `skills/gh-project-manage/SKILL.md` — canonical Claude/Codex front-door skill; the `.claude/skills/...` path is a compatibility shim.
- `.claude/agents/gh-project-manager.md` — execution subagent for delegated work (health audits,
  bulk triage, sub-issue restructuring), with a generic 7-point health-audit template and citation
  contract.

**As a Claude Code plugin** (`.claude-plugin/plugin.json`): install this repo as a plugin and you
get the MCP server + skill wired up together automatically.

**Manually, for global availability across all your projects**: copy the skill/agent files into
your user-scope Claude Code config so they apply everywhere, not just when working inside this repo:

```bash
cp -r .claude/skills/gh-project-manage ~/.claude/skills/
cp .claude/agents/gh-project-manager.md ~/.claude/agents/
```

## Not yet covered

Two broad GitHub Projects areas still need additional tooling: **Insights chart authoring** remains UI-driven, and project **workflow authoring beyond the covered Auto-add workflow** (for example auto-archive and other workflow types) remains UI-only apart from `deleteProjectV2Workflow`. `gh_project_workflow_autoadd_configure` covers Auto-add through the browser and verifies both repository and filter after save. View CRUD itself is API-backed; optional view `groupBy` still uses the isolated browser fallback. Iteration/sprint config and date-setting are API-backed and covered.

Both remaining browser-only tools fail closed with a `capability_unavailable` error — and never import Playwright — on any runtime where the Edge/CDP fallback cannot possibly work (see [docs/CAPABILITIES.md](docs/CAPABILITIES.md)). The remote HTTP transport (`server-http.mjs`, #60) is implemented and documented in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md); this repository does not itself provision or operate a publicly reachable deployment.

## License

MIT
