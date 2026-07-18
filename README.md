# gh-projects-mcp

MCP server for managing [GitHub Projects v2](https://docs.github.com/en/issues/planning-and-tracking-with-projects) —
fields, items, views, sub-issues, and status updates — from any repo, chat, or editor that speaks MCP
(Claude Code, Claude Desktop, VS Code Copilot, etc.).

Every tool takes `owner`/`repo`/project `number` as explicit parameters. Nothing is hardcoded to one
project, so the same server works across all your GitHub Projects boards without copying scripts
into every repo.

## Why this exists

GitHub's public GraphQL API has a real gap: there is no `createProjectV2View` mutation, and view
*layout* (table/board/roadmap) cannot be set through the API at all — it's web-UI only. Most of this
server is a thin wrapper over `gh` CLI / GraphQL, but view management (`gh_project_view_create`,
`gh_project_view_delete`) drives the actual GitHub web UI via Playwright, CDP-attached to your
existing logged-in Edge browser session (not a fresh headless browser).

## Tools

| Tool | What it does |
|---|---|
| `gh_auth_status` | Check `gh` CLI auth + `project` scope |
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
| `gh_project_field_create` | Create a custom field |
| `gh_project_field_option_update` | Add/rename/recolor SINGLE_SELECT options (delete-guarded) |
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
| `gh_project_views_list` | List views (read-only, GraphQL) |
| `gh_project_view_create` | Create/repair views (Playwright — see above) |
| `gh_project_view_delete` | Delete a view (Playwright) |
| `gh_issue_create` | Create an issue |
| `gh_issue_list` | List issues (includes GraphQL node `id`) |
| `gh_label_ensure` | Idempotent label creation |
| `gh_subissue_link` | Link a sub-issue to a parent/epic |
| `gh_subissue_unlink` | Remove a sub-issue link |
| `gh_subissue_reprioritize` | Reorder a sub-issue within its parent |
| `gh_status_update_list` | List a project's status updates |
| `gh_status_update_edit` | Edit a status update |
| `gh_status_update_delete` | Delete a status update (confirm-gated) |
| `gh_status_update_create` | Post a project status update |

## Requirements

- [`gh` CLI](https://cli.github.com/), authenticated with the `project` scope
  (`gh auth refresh -s project`)
- Node.js 18+
- For view management: Microsoft Edge, signed into github.com (the Playwright automation attaches
  to this session via Chrome DevTools Protocol rather than launching a fresh browser)

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

## Bundled Skill + subagent

This repo also ships the judgment layer that sits on top of the MCP tools:

- `.claude/skills/gh-project-manage/SKILL.md` — front-door skill; routes simple asks to a single
  tool call, delegates multi-step work to the subagent below.
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

Two GitHub Projects features are genuinely UI-only (no API) and remain unported: **Insights chart**
creation/rename, and project **workflow authoring** (auto-add/auto-archive — only
`deleteProjectV2Workflow` has an API). Both need Playwright/CDP like the view tools. (Iteration/sprint
config and date-setting are API-backed and *are* covered — `gh_project_iteration_configure` /
`gh_project_item_edit`.)

## License

MIT
