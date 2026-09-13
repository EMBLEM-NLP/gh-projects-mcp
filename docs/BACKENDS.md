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

### Project fields, items, and views

`lib/project-api-compat.mjs` covers `gh project field-list/-create/-delete`, `item-list/-add/-create/-edit/-archive/-delete`, and (as of the GraphQL view migration) view create/edit/delete — all via direct GraphQL through the same `GitHubApiBackend`, not the `gh` CLI. This section of `docs/CHANGELOG`-adjacent history was previously undocumented here even though the code has covered it for several releases; noting it now rather than leaving the gap.

**One operation, `item-add`, additionally has a real REST path** (`GitHubApiBackend.itemAddRest`, `POST /{orgs|users}/{owner}/projectsV2/{project_number}/items`), used automatically instead of GraphQL when the backend supports it. Verified directly against GitHub's own OpenAPI description (`github/rest-api-description`, `descriptions/api.github.com/api.github.com.json`) rather than assumed — an earlier, unverified claim that GitHub shipped broad Projects v2 REST coverage turned out to both understate it (a much larger surface exists than a changelog-only search suggested) and overstate it (several operations below have real gaps). The full verified `projectsV2` REST surface, and why most of it is *not* migrated yet:

| Path | Methods | Status here |
|---|---|---|
| `.../projectsV2` | GET | Not migrated — REST project objects have no `readme` or web `url` field, which `gh_project_view`/`_edit` currently return; migrating would silently drop them. |
| `.../projectsV2/{n}` | GET | Same gap as above. |
| `.../projectsV2/{n}/drafts` | POST | Not migrated. Would parallel `item-create`; not yet done. |
| `.../projectsV2/{n}/fields` | GET, POST | Not migrated. `POST` field creation supports `text`/`number`/`date`/`single_select`/`iteration` but has **no `multi_select`** — a full migration needs a GraphQL fallback for that one case. |
| `.../projectsV2/{n}/fields/{field_id}` | GET | No REST DELETE exists anywhere for a single field — `field-delete` stays GraphQL-only permanently, not just "for now". |
| `.../projectsV2/{n}/items` | GET, **POST (migrated)** | `GET` returns only each item's `title` field by default; other field values need an explicit `fields=<id>,<id>,...` query param the caller must already know — GraphQL's `item-list` returns all values in one call today, so migrating `GET` is a behavior change, not a drop-in swap. |
| `.../projectsV2/{n}/items/{item_id}` | GET, PATCH, DELETE | `PATCH`'s `value` is `string \| number \| null` — no array type, so MULTI_SELECT item field values (which need an array of option IDs) must stay on GraphQL, matching what `lib/field-mutations.mjs`'s `updateMultiSelectItemField` already special-cases. |
| `.../projectsV2/{n}/views` | POST | Not migrated. The GraphQL view-migration PR landed independently and already covers create/edit/delete; REST create has no equivalent for edit/delete/groupBy, so switching just creation for a partial win wasn't worth it. |
| `.../projectsV2/{n}/views/{v}/items` | GET | Read-only, unused. |

None of the above changes anything about `gh_project_workflow_autoadd_configure` — confirmed no `/workflows` or `/insights` path exists anywhere under `projectsV2` in the current spec; those remain genuinely UI-only.

Every REST `projectsV2` object's `id` is a plain integer, not the GraphQL global node ID string every other tool call in this codebase passes around (`PVT_...`, `PVTI_...`, etc.) — the same object also carries `node_id` holding that string. Any REST-backed method here must surface `node_id` as its external `id`, never the numeric one, or downstream ID-consuming tools break silently. `itemAddRest` does this remapping; any future REST addition must too.

## Why the API backend is synchronous for now

Most existing tool handlers use synchronous `gh()` / `gql()` helpers. To preserve those public tool contracts while the backend boundary is introduced, direct API requests run through a short-lived Node request runner. This removes the external `gh` binary requirement for migrated operations without forcing a flag-day rewrite of every handler.

A later refactor may make the internal backend interface fully async once all handlers are dependency-injected.

## Security / identity rules

- Prefer GitHub App installation tokens for hosted deployments.
- `GH_PROJECTS_TOKEN` takes precedence over `GITHUB_TOKEN`.
- `GH_PROJECTS_BACKEND=api` never falls back to local `gh` authentication.
- Unsupported API-backend operations return `capability_unavailable`; they do not invoke a different backend.
- A PR merge and branch cleanup are two distinct outcomes. Once GitHub reports the PR merged, failure to delete the branch is surfaced as cleanup status rather than a merge failure.
