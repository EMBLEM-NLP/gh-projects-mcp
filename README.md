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
| `gh_project_link` | Link a project to a repo |
| `gh_project_field_list` | List fields + option IDs |
| `gh_project_field_create` | Create a custom field |
| `gh_project_item_list` | List items on a board |
| `gh_project_item_add` | Add an issue/PR to a board |
| `gh_project_item_edit` | Set/clear a field value on an item |
| `gh_project_item_archive` | Archive/unarchive an item |
| `gh_project_views_list` | List views (read-only, GraphQL) |
| `gh_project_view_create` | Create/repair views (Playwright — see above) |
| `gh_project_view_delete` | Delete a view (Playwright) |
| `gh_issue_create` | Create an issue |
| `gh_issue_list` | List issues (includes GraphQL node `id`) |
| `gh_label_ensure` | Idempotent label creation |
| `gh_subissue_link` | Link a sub-issue to a parent/epic |
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

## Not yet covered

Some more exotic, UI-only GitHub Projects features aren't ported here yet: Insights chart
creation/rename, GitHub Actions workflow toggling, milestone-date backfill, sprint/iteration field
assignment. These remain doable via `gh api graphql` / ad hoc Playwright, just not wrapped as tools.

## License

MIT
