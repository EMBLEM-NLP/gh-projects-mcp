---
name: gh-project-manage
description: Manage GitHub Projects v2 through gh-projects-mcp across Claude, Codex, and other MCP clients. Use for project boards, fields, items, views, issues, PRs, sub-issues, status updates, audits, prioritization, and github.com users/orgs project URLs.
version: 1.9.0
---

# GitHub Projects Manager

This is the canonical, client-neutral skill for `gh-projects-mcp`.

Use the MCP server's `gh_*` tools whenever an equivalent tool exists. Do not bypass the server with raw `gh` or hand-written GraphQL for normal operations: the MCP tools carry confirmation gates, ID resolution rules, backend portability, and compatibility behavior used by both Claude and Codex.

The skill is generic. Never hardcode an owner, project number, project ID, field ID, option ID, item ID, repository, or branch.

## Preflight

1. Call `gh_auth_status` before a mutation-heavy workflow.
   - The server may be using the local `gh-cli` backend or the direct `github-api` backend.
   - Treat the tool result as the source of truth for the active identity/backend; do not silently switch identities.
2. Establish `owner` and project `number`.
   - Parse `github.com/users/<owner>/projects/<number>` or `github.com/orgs/<owner>/projects/<number>` directly when supplied.
   - Otherwise use `gh_project_list` and `gh_project_view`.
3. Before editing project field values, call `gh_project_field_list` and resolve current field/option IDs. Never reuse IDs from memory.
4. For destructive operations, preserve the tool's `confirm:true` requirement. Do not manufacture confirmation on the user's behalf.

## Intent routing

| Intent | MCP tools |
|---|---|
| List projects | `gh_project_list` |
| Inspect a project | `gh_project_view`, `gh_project_field_list`, `gh_project_item_list`, `gh_project_views_list` |
| Create/edit/copy project | `gh_project_create`, `gh_project_edit`, `gh_project_copy` |
| Link/unlink repository or team | `gh_project_link`, `gh_project_unlink` |
| Mark/unmark template | `gh_project_mark_template` |
| Delete project | `gh_project_delete` — confirm-gated |
| Create/list/delete fields | `gh_project_field_create`, `gh_project_field_list`, `gh_project_field_delete` |
| Change single/multi-select options | `gh_project_field_option_update` — send the complete desired option set; preserve IDs and respect the removal guard |
| Configure iterations | `gh_project_iteration_configure` |
| List/add/create items | `gh_project_item_list`, `gh_project_item_add`, `gh_project_item_create` |
| Edit draft issue | `gh_project_draft_edit` |
| Convert draft to repo issue | `gh_project_draft_convert` |
| Edit/clear item field | `gh_project_item_edit` — MULTI_SELECT uses option-ID arrays |
| Archive/unarchive item | `gh_project_item_archive` |
| Remove item from board | `gh_project_item_delete` — confirm-gated |
| Reorder item | `gh_project_item_move` |
| List/create/edit/delete project views | `gh_project_views_list`, `gh_project_view_create`, `gh_project_view_edit`, `gh_project_view_delete` |
| Configure auto-add workflow | `gh_project_workflow_autoadd_configure` — browser-only; omitting `filter` clears any existing filter |
| Create/list/edit/close repo issues | `gh_issue_create`, `gh_issue_list`, `gh_issue_edit`, `gh_issue_close` — close is confirm-gated |
| Ensure repo label | `gh_label_ensure` |
| Open/list/merge PRs | `gh_pr_create`, `gh_pr_list`, `gh_pr_merge` — merge confirm-gated |
| Link/unlink/reorder sub-issues | `gh_subissue_link`, `gh_subissue_unlink`, `gh_subissue_reprioritize` |
| Project status updates | `gh_status_update_create`, `gh_status_update_list`, `gh_status_update_edit`, `gh_status_update_delete` |

## Multi-step board work

For requests such as "organize this board", "rank the backlog", "audit this project", or "triage all active issues":

1. Read project details, fields, items, and relevant views first.
2. Build the desired end state before mutating.
3. Resolve field and option IDs immediately before writes.
4. Apply changes in dependency order.
5. Re-read affected state and verify the result.
6. Report any skipped/blocked capability instead of pretending it succeeded.

Claude environments may delegate large workflows to the repository's `gh-project-manager` subagent. Codex can execute the same sequence directly. Delegation is optional; the MCP tool contract is the common execution layer.

## Project-board operating model

When no user-specific model exists, prefer a lean board rather than proliferating overlapping fields:

- use GitHub's built-in `Status` field for workflow state;
- add custom fields only when they represent a separate dimension such as Priority, Area, or Work type;
- do not create a custom field with the same semantic meaning as a built-in field;
- keep active execution views focused and move completed/obsolete work out of the primary view.

For EMBLEM-NLP Project #1 specifically, issue #28 in this repository is the dogfood specification and source of truth for its canonical fields, views, and ranking.

## Field and ID rules

- Project IDs, item IDs, field IDs, option IDs, and iteration IDs are opaque GitHub node IDs. Resolve them fresh.
- Built-in Projects fields cannot be recreated as custom fields. Call `gh_project_field_list` first.
- `gh_project_item_edit` needs the project node ID, item ID, and field ID. Single-select/iteration values use option/iteration IDs; MULTI_SELECT uses an array of option IDs, never display labels.
- Sub-issue tools need issue GraphQL node IDs; obtain them from `gh_issue_list`.
- `gh_project_field_option_update` replaces the option collection but now preserves existing option IDs automatically for unchanged names and unambiguous renames. Supply explicit IDs for ambiguous renames; removing options requires `allowRemove:true` and reports removed IDs/names.

## Views and browser capability

Ordinary Project view CRUD is API-backed: create, rename, layout, filter, ordered visible fields, and delete do not require a browser.

- `gh_project_view_create` is declarative and GraphQL-backed for ordinary settings.
- `gh_project_view_edit` updates one view by name through `updateProjectV2View`.
- `gh_project_view_delete` uses `deleteProjectV2View` and remains confirm-gated.
- The optional `groupBy` input is currently the only view setting that falls back to the existing logged-in Edge/CDP capability because GitHub's GraphQL view mutation input does not expose group-by fields.
- A request that does not contain `groupBy` must never require or launch Edge.
- If `groupBy` is requested and the browser capability is unavailable, report that limitation; do not silently drop the requested grouping.
- `gh_project_workflow_autoadd_configure` is explicitly `browser-ui` only. It always writes the desired filter state: omitting `filter` clears an existing filter, and success requires post-save verification of both repository and filter.

## PR-first code workflow

When the task changes repository code rather than only board metadata:

1. Work on a feature/fix/chore branch, not the default branch.
2. Test/lint before opening the PR.
3. Use `gh_pr_create` with a clear body and same-repo `Closes #N` when appropriate.
4. Keep cross-repo references as `Refs owner/repo#N`; GitHub does not auto-close cross-repo issues through that syntax.
5. Merge only when the user has authorized it; `gh_pr_merge` requires `confirm:true`.

## Safety

- Never delete projects, fields, items, views, status updates, close issues, or merge PRs without the user's explicit authorization and the tool's confirmation gate.
- Archiving a Project item is not the same as closing its underlying issue.
- Removing an item from a board does not delete its underlying issue/PR.
- If a mutation fails, surface the actual error. Do not retry blindly or silently switch backend/account.
- After structural writes, verify final GitHub state before reporting success.

## Runtime portability

The same server is intended to run in multiple clients:

- Claude/local: stdio, usually `GhCliBackend` or direct API backend.
- Codex/local: the same stdio server through the Codex plugin package.
- Hosted/remote clients: future remote transport tracked by #60.

For shared capabilities, client choice must not change tool names, schemas, confirmation semantics, or resulting GitHub state. `contracts/tools.json` is the committed protocol contract and CI drift gate.
