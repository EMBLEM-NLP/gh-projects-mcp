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

## Why the API backend is synchronous for now

Most existing tool handlers use synchronous `gh()` / `gql()` helpers. To preserve those public tool contracts while the backend boundary is introduced, direct API requests run through a short-lived Node request runner. This removes the external `gh` binary requirement for migrated operations without forcing a flag-day rewrite of every handler.

A later refactor may make the internal backend interface fully async once all handlers are dependency-injected.

## Security / identity rules

- Prefer GitHub App installation tokens for hosted deployments.
- `GH_PROJECTS_TOKEN` takes precedence over `GITHUB_TOKEN`.
- `GH_PROJECTS_BACKEND=api` never falls back to local `gh` authentication.
- Unsupported API-backend operations return `capability_unavailable`; they do not invoke a different backend.
- A PR merge and branch cleanup are two distinct outcomes. Once GitHub reports the PR merged, failure to delete the branch is surfaced as cleanup status rather than a merge failure.
