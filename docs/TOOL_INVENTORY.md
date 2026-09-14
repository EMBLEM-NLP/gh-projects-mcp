# gh-projects-mcp tool inventory

Generated from [`contracts/tools.json`](../contracts/tools.json) by
`node scripts/render-tool-inventory.mjs` — do not hand-edit. Regenerate with
`npm run contract:write && npm run docs:tools` whenever the tool contract
changes, and check both files in together.

- Server: `gh-projects-mcp` v1.9.0
- Tool count: 45
- Confirm-gated (destructive, require `confirm: true`): 7

Params marked `?` are optional; the rest are required. ⚠️ marks a tool that
requires `confirm: true` because it is destructive or irreversible.

## Auth & diagnostics

### `gh_auth_status`

Check the authenticated gh CLI account and whether it has the 'project' scope required for all other tools in this server.

Params: _none_

### `gh_preflight`

Report this server's runtime capability matrix as structured JSON: transport, selected backend, and rest/graphql/projectsRead/projectsWrite/issuePr/browserUi readiness (ready/unavailable/unknown). Never includes token values. Default is configuration-only detection; pass live:true to also attempt one REST call, one GraphQL call, and (on win32 only) a local Edge/CDP reachability probe.

Params: `live`?

## Projects

### `gh_project_copy`

Copy a project to a new one (fields/views copied; items only with drafts:true).

Params: `drafts`?, `number`, `sourceOwner`, `targetOwner`, `title`

### `gh_project_create`

Create a new GitHub Project (v2) board for a user or org.

Params: `owner`, `title`

### `gh_project_delete` ⚠️

Permanently DELETE a project board and all its items. Irreversible — requires confirm:true.

Params: `confirm`, `number`, `owner`

### `gh_project_edit`

Edit a project's metadata: title, description (shortDescription), README body, visibility, and open/closed state. Pass only the fields you want to change. Maps to `gh project edit` (title/description/readme/visibility) and `gh project close`/`--undo` (closed).

Params: `closed`?, `description`?, `number`, `owner`, `readme`?, `title`?, `visibility`?

### `gh_project_link`

Link a GitHub Project to a repository (or team), so items in that repo can be auto-added and the project shows up on the repo page.

Params: `number`, `owner`, `repo`

### `gh_project_list`

List GitHub Projects (v2) owned by a user or organization.

Params: `owner`

### `gh_project_mark_template`

Mark (or, with undo:true, unmark) an ORG-owned project as a template. User-owned projects cannot be templates.

Params: `number`, `owner`, `undo`?

### `gh_project_unlink`

Unlink a project from a repository or team (mirror of gh_project_link).

Params: `number`, `owner`, `repo`?, `team`?

### `gh_project_view`

Get full details of one GitHub Project: title, description, visibility, item count, fields, and views (including view layout/createdAt, which the plain gh CLI does not surface).

Params: `number`, `owner`

## Project fields

### `gh_project_field_create`

Create a custom Project field. TEXT/NUMBER/DATE/SINGLE_SELECT/MULTI_SELECT/ITERATION are supported through GraphQL; select fields require options and iteration fields require iterationConfiguration.

Params: `dataType`, `iterationConfiguration`?, `name`, `number`, `options`?, `owner`

### `gh_project_field_delete` ⚠️

Permanently DELETE a custom field and its values on all items. Destructive — requires confirm:true. Built-in fields cannot be deleted.

Params: `confirm`, `fieldId`

### `gh_project_field_list`

List all fields on a project (built-in like Status/Assignees plus custom fields), with their IDs and option IDs for single-select fields. Always call this before gh_project_field_create or gh_project_item_edit to get current IDs — never hardcode them.

Params: `number`, `owner`

### `gh_project_field_option_update`

Safely replace SINGLE_SELECT or MULTI_SELECT options while preserving existing option IDs. Pass the COMPLETE desired option set. Existing IDs are preserved by explicit id, unchanged name, or a single unambiguous rename; ambiguous renames fail closed. Removing options requires allowRemove:true and reports removed IDs/names.

Params: `allowRemove`?, `fieldId`, `options`

### `gh_project_iteration_configure`

Configure an ITERATION field using GitHub's current schema. startDate/duration default from the first requested iteration for backwards compatibility; existing titles are preserved when omitted and the mutation is round-trip verified.

Params: `duration`?, `fieldId`, `iterations`, `startDate`?

## Project items

### `gh_project_draft_convert`

Convert a draft-issue item into a real repository issue (convertProjectV2DraftIssueItemToIssue). The item keeps its board field values.

Params: `itemId`, `repo`, `repoOwner`

### `gh_project_draft_edit`

Edit a draft issue item's title and/or body (updateProjectV2DraftIssue). Accepts the project ITEM id (PVTI_…, from gh_project_item_create/list) and resolves the draft-content id (DI_…) that gh requires; a DI_ id is also accepted directly. For draft items only; use gh_project_item_edit for field values.

Params: `body`?, `itemId`, `title`?

### `gh_project_item_add`

Add an existing issue or pull request to a project board by URL.

Params: `number`, `owner`, `url`

### `gh_project_item_archive`

Archive (or unarchive) an item on a project board without deleting the underlying issue/PR.

Params: `itemId`, `number`, `owner`, `undo`?

### `gh_project_item_create`

Create a draft-issue item directly on a project board (no repo issue). Draft issues live only on the board until converted with gh_project_draft_convert. Returns the created item (with its id).

Params: `body`?, `number`, `owner`, `title`

### `gh_project_item_delete` ⚠️

Remove an item from a project board permanently (distinct from archive). Does NOT delete the underlying issue/PR. Destructive — requires confirm:true.

Params: `confirm`, `itemId`, `number`, `owner`

### `gh_project_item_edit`

Set or clear one Project item field value. MULTI_SELECT uses values[] of option IDs; other select/iteration values use value with the current option/iteration ID.

Params: `clear`?, `fieldId`, `itemId`, `projectId`, `value`?, `values`?, `valueType`

### `gh_project_item_list`

List items (issues, PRs, draft issues) on a project board, with their current field values.

Params: `limit`?, `number`, `owner`, `query`?

### `gh_project_item_move`

Reorder an item on the board. Places it after afterItemId, or at the top if omitted (updateProjectV2ItemPosition).

Params: `afterItemId`?, `itemId`, `projectId`

## Project views

### `gh_project_view_create` _(requires: browser-ui:groupBy)_

Declaratively create or reconcile Project views. Normal create/layout/filter/visible-field CRUD uses GitHub GraphQL. groupBy remains an explicit browser-ui fallback. Existing names are skipped unless reapply=true; pruneGhostViews deletes non-spec views (except the first/default view) and repairs layout mismatches.

Params: `number`, `owner`, `pruneGhostViews`?, `reapply`?, `views`

### `gh_project_view_delete` ⚠️

Delete one Project view by name through deleteProjectV2View and verify it is absent. Destructive — requires confirm:true. No browser is used.

Params: `confirm`, `number`, `owner`, `viewName`

### `gh_project_view_edit` _(requires: browser-ui:groupBy)_

Edit one Project view by name. name/layout/filter/visibleFieldIds are GraphQL-backed. groupBy is the only browser-ui fallback.

Params: `filter`?, `groupBy`?, `layout`?, `name`?, `number`, `owner`, `viewName`, `visibleFieldIds`?

### `gh_project_views_list`

List a project's views with stable node IDs, layout, filter, ordered visible fields, and current group-by configuration.

Params: `number`, `owner`

## Project workflows

### `gh_project_workflow_autoadd_configure` _(requires: browser-ui)_

Configure GitHub Projects "Auto-add to project" through the browser-only Workflows UI. Omit filter to explicitly clear any existing filter and include every issue/PR. Requires local logged-in Edge/CDP and verifies both repository and filter after save.

Params: `filter`?, `number`, `owner`, `repo`, `workflowName`?

## Issues

### `gh_issue_close` ⚠️

Close a repository issue with a completed or not-planned reason, then re-read and verify the final state. Requires confirm:true and refuses pull-request numbers.

Params: `confirm`, `number`, `owner`, `reason`?, `repo`

### `gh_issue_create`

Create an issue in a repo. Body is written via a temp file to avoid shell-escaping issues with newlines/quotes.

Params: `body`?, `labels`?, `milestone`?, `owner`, `repo`, `title`

### `gh_issue_edit`

Edit a repository issue and verify final state. Title/body/labels are non-destructive; closing through state=closed requires confirm:true. Pull-request numbers are refused.

Params: `body`?, `closeReason`?, `confirm`?, `labels`?, `number`, `owner`, `removeLabels`?, `repo`, `state`?, `title`?

### `gh_issue_list`

List issues in a repo, including each issue's GraphQL node id (needed by gh_subissue_link).

Params: `limit`?, `owner`, `repo`, `state`?

## Pull requests

### `gh_pr_create`

Open a pull request in a repo (wraps `gh pr create`). head is the branch to merge FROM; base (default "main") is the branch to merge INTO. Returns the created PR URL.

Params: `base`?, `body`?, `draft`?, `head`, `owner`, `repo`, `title`

### `gh_pr_list`

List pull requests in a repo (wraps `gh pr list`) with number, title, url, state, head/base branches, mergeability, and draft flag.

Params: `limit`?, `owner`, `repo`, `state`?

### `gh_pr_merge` ⚠️

Merge a pull request (wraps `gh pr merge`). Destructive — requires confirm:true. Defaults to a squash merge and deletes the head branch afterwards.

Params: `confirm`, `deleteBranch`?, `method`?, `number`, `owner`, `repo`

## Labels

### `gh_label_ensure`

Create a label in a repo if it does not already exist (idempotent — safe to call every time before using a label).

Params: `color`, `description`?, `name`, `owner`, `repo`

## Sub-issues

### `gh_subissue_link`

Link an issue as a sub-issue of a parent (epic) issue. Both IDs must be GraphQL node IDs (not issue numbers) — get them from the `id` field returned by gh_issue_list.

Params: `childNodeId`, `parentNodeId`

### `gh_subissue_reprioritize`

Reorder a sub-issue within its parent (reprioritizeSubIssue). Places it after afterChildNodeId, or at the top if omitted.

Params: `afterChildNodeId`?, `childNodeId`, `parentNodeId`

### `gh_subissue_unlink`

Remove a sub-issue link (removeSubIssue). Detaches the child; deletes neither issue.

Params: `childNodeId`, `parentNodeId`

## Status updates

### `gh_status_update_create`

Post a status update on a project (the "Add status update" feature on the project overview page). Requires project write scope.

Params: `body`?, `projectId`, `status`

### `gh_status_update_delete` ⚠️

Delete a project status update. Destructive — requires confirm:true.

Params: `confirm`, `statusUpdateId`

### `gh_status_update_edit`

Edit an existing project status update (any of status/body/startDate/targetDate).

Params: `body`?, `startDate`?, `status`?, `statusUpdateId`, `targetDate`?

### `gh_status_update_list`

List a project's status updates (id, status, body, dates).

Params: `projectId`
