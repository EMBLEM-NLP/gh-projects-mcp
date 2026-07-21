---
name: gh-project-manage
description: Front door for managing any GitHub Project (v2) board — creating projects, fields, items, views, sub-issues, status updates. Routes intent to the right gh-projects-mcp tool and encodes decisions the GitHub API can't (reserved field names, view-layout limitations, naming conventions). Works on any owner/project/repo — not tied to one project. Trigger on "github project", "project board", "gh project", or a github.com/users/*/projects/* or /orgs/*/projects/* URL.
version: 1.0.0
created: 2026-07-15
lastmod: 2026-07-15
---

## Charter

Invoke this skill for any GitHub Projects v2 task — creating a board, triaging issues, adding/fixing
views, linking sub-issues, posting status updates, or auditing project health. All mutations go
through the `gh-projects-mcp` MCP server's tools (prefix `gh_*`) — never shell out to raw `gh`
commands yourself when an equivalent tool exists, since the tools already encode the gotchas below.

This is a **generic, cross-project** skill. It has no hardcoded owner, project number, or field IDs.
Every task starts by establishing which project you're working on (see Pre-flight).

## Pre-flight

1. **Confirm auth**: call `gh_auth_status`. If it lacks the `project` scope, tell the user to run
   `gh auth refresh -s project` — don't attempt to fix this yourself.
2. **Establish project anchors** — you need an `owner` (user/org login) and project `number` for
   almost every tool call:
   - If the user gave a URL like `github.com/users/<owner>/projects/<number>` or
     `.../orgs/<owner>/projects/<number>`, parse it directly.
   - If working inside a repo that has `.github/project-ids.json` (a legacy per-repo anchor file
     from earlier bespoke scripts), you may read it for a cached `projectId`/`fieldIds` — but treat
     it as a cache, not a source of truth. Verify against `gh_project_field_list` if it looks stale.
   - Otherwise ask the user, or call `gh_project_list` with a likely owner to let them pick.
3. **Get field IDs fresh**: call `gh_project_field_list` before any field mutation
   (`gh_project_field_create`, `gh_project_item_edit`). Field/option IDs are project-specific and
   regenerate if a field is ever recreated — never hardcode them in a skill or memory.

## Intent routing

Two kinds of intent need different handling — decide which before doing anything:

**Direct (handle yourself, 1-2 tool calls)** — simple, single-target asks:

| User intent | Tool(s) |
|---|---|
| "what projects do I have" | `gh_project_list` |
| "show me project details / fields / views" | `gh_project_view` (also returns views+layouts) |
| "create a new project board" | `gh_project_create`, then `gh_project_field_create` per custom field |
| "edit the project's title/description/README/visibility, or close/reopen it" | `gh_project_edit` |
| "link this repo to the project" | `gh_project_link` |
| "add an issue to the board" | `gh_project_item_add` (existing issue) or `gh_issue_create` + `gh_project_item_add` (new issue) |
| "add a draft item (no repo issue)" | `gh_project_item_create`; edit it with `gh_project_draft_edit`; turn it into a real issue with `gh_project_draft_convert` |
| "set priority/status/owner on an item" | `gh_project_field_list` (get field + option IDs) → `gh_project_item_edit` |
| "add/rename/recolor a single-select field's options" | `gh_project_field_option_update` (pass the FULL option set — it replaces; delete-guarded unless `allowRemove:true`) |
| "set up a sprint/iteration field's iterations" | `gh_project_iteration_configure` |
| "add/fix a view" | `gh_project_view_create` (idempotent — skips existing names unless `reapply: true`) |
| "delete a view" | `gh_project_view_delete` |
| "post a status update" | `gh_status_update_create` |
| "archive this item" | `gh_project_item_archive` |

**Delegate to the `gh-project-manager` subagent** — multi-step work spanning many items or requiring
judgment across a whole board:

| User intent | Why it's delegated |
|---|---|
| "audit the project" / "health check" | 7-point audit needs many correlated tool calls + judgment |
| "triage this issue" (or several) | Setting multiple fields + labels per issue, often across a batch |
| "break this into sub-issues" | Multiple `gh_issue_create` + `gh_subissue_link` calls that need to stay consistent (parent hierarchy, shared labels) |
| Anything spanning more than ~3 tool calls, or where you'd need to hold cross-item state in your head | Keeps your own context focused on routing; the subagent gets a dedicated budget for the work and reports back with citations |

To delegate: give the subagent a task brief with project anchors (owner, number, repo), the specific
items in scope, and expected output — see `gh-project-manager`'s own "Expected task brief" section.
Relay its report back to the user; don't silently re-do or second-guess its work without reason.

## Known gotchas (learned the hard way across two prior bespoke implementations)

These are already handled *inside* the tools where possible — listed here so you know what's
happening and don't fight the abstraction:

- **Reserved field names**: Projects v2 ships built-in fields (`Status`, `Title`, `Assignees`,
  `Labels`, `Milestone`, `Repository`, `Reviewers`, `Linked pull requests`, ...). Calling
  `gh_project_field_create` with one of these exact names throws a GraphQL error — call
  `gh_project_field_list` first and reuse the existing field's ID instead of creating a duplicate.
- **No API for view creation or layout** — confirmed via GraphQL introspection: there is no
  `createProjectV2View` mutation, and layout (table/board/roadmap) cannot be set any other way.
  `gh_project_view_create` works around this by driving the actual GitHub web UI via Playwright,
  **CDP-attaching to an Edge you already have running with remote debugging** (not a fresh headless
  session). It will **not** open or close your browser: if no DevTools endpoint is on `:9222` it fails
  with instructions to relaunch Edge yourself with `--remote-debugging-port=9222` (signed into
  github.com). Tell the user that if they hit that error.
- **View creation is not instant** — each view takes several seconds (page navigation + UI
  interaction). Don't be surprised if `gh_project_view_create` takes 10-30s per view.
- **Naming convention** (carried over from prior projects, use unless the user specifies otherwise):
  `<Purpose> — <Grouping/Qualifier>` with an em-dash, e.g. "Board — By Status", "Board — By Owner".
  Single-purpose views with no qualifier need no dash: "Active Work", "Backlog".
- **Table vs. board layout**: table for filtering/sorting/scanning many items; board for kanban-style
  swimlanes grouped by a single-select field (Status, Owner, Area, etc.). Roadmap layout only makes
  sense if the project actually has Start/Target Date fields populated.
- **Sub-issue linking needs GraphQL node IDs, not issue numbers.** `gh_issue_list` returns each
  issue's `id` field for exactly this reason — don't try to pass a bare issue number to
  `gh_subissue_link`.
- **`gh_project_item_edit` needs the *project's* node ID, not the item's.** Get `projectId` from
  `gh_project_view` or `gh_project_create`'s return value; get `itemId` from `gh_project_item_list`
  or the return value of `gh_project_item_add`.
- **Status update enum values**: `ON_TRACK`, `AT_RISK`, `OFF_TRACK`, `COMPLETE`, `INACTIVE`. Requires
  the token to have project write scope.
- **Ghost/mismatched views are NOT pruned by default**: `gh_project_view_create` creates missing
  views but only **reports** ghost tabs (not in your spec) and layout-mismatched views under
  `wouldPrune` — it does not delete them unless you pass `pruneGhostViews:true`. `gh_project_view_delete`
  likewise requires `confirm:true`. This matches the confirm-gate on every other destructive tool.

## Safety

- Never close/delete issues, merge PRs, or push branches without explicit user confirmation.
- **View tools are destructive-capable and browser-touching.** `gh_project_view_delete` needs
  `confirm:true`; `gh_project_view_create` will not prune/recreate views unless `pruneGhostViews:true`;
  and neither will open or force-close your Edge — they attach to an already-running remote-debugging
  Edge and otherwise fail with guidance.
- Never hardcode project/field/item IDs into memory or a skill file — they're project-specific and
  regenerate if a field or project is recreated. Always resolve them fresh via the list/view tools.
- If a mutation tool errors, read the error text back to the user rather than retrying blindly —
  most failures here are either an auth-scope issue or a reserved-name collision, both of which need
  a human decision, not a retry loop.

## Related

- MCP server: `gh-projects-mcp` — this repo's `server.mjs` implements every `gh_*` tool referenced
  above. See the repo README for install/registration instructions.
- Subagent: `gh-project-manager` (`.claude/agents/gh-project-manager.md` in this repo) — the
  execution layer for delegated multi-step work (see "Intent routing" above). Same tool hierarchy
  and gotchas as this skill, plus a generic 7-point health audit template and citation contract.
- Some GitHub Projects features aren't covered by `gh-projects-mcp` yet: Insights chart
  creation/rename, GitHub Actions workflow-toggle automation, milestone-date backfill, and
  sprint/iteration field assignment. These need ad hoc `gh api graphql` / Playwright until someone
  ports them into a proper tool — see this repo's README "Not yet covered" section.
