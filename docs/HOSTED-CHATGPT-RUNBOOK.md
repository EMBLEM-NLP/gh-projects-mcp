# Hosted ChatGPT / portfolio-ops execution runbook

## Scope
This repository's existing HTTP MCP transport is the bridge between a remotely hosted MCP client and GitHub Projects v2. This PR packages it for container deployment; it does **not** provision hosting, install a ChatGPT connector, or create a Projects board.

## Security boundary
- The server must sit behind a TLS-terminating reverse proxy or trusted platform ingress. Do not publish port 3000 directly.
- Keep `GH_PROJECTS_HTTP_REQUIRE_AUTH=true`; callers must supply their own `Authorization: Bearer <GitHub token>`.
- Never put a GitHub PAT into Git, build arguments, a Dockerfile, chat messages or logs. Configure credentials through a trusted client/secret manager.
- A bearer token is a GitHub credential, **not** a separate service-access secret. It grants exactly the token's GitHub permissions. Limit network access and token scopes.
- `/healthz` is unauthenticated and reports process health only, not GitHub permissions.
- Hosted Linux does not support Edge/CDP UI-only operations; keep `GH_PROJECTS_DISABLE_BROWSER_UI=1`.

## Local validation
```bash
npm ci
npm test
npm run lint
npm run contract:check
docker build -t gh-projects-mcp:local .
docker run --rm -p 127.0.0.1:3000:3000 gh-projects-mcp:local
curl -fsS http://127.0.0.1:3000/healthz
```
Expected health response: `{"status":"ok","transport":"http"}`.

## Hosted connection
1. Deploy the container to a private or ingress-protected host with HTTPS and streaming POST support at `/mcp`.
2. Configure the MCP client to reach `https://<your-host>/mcp` and supply an appropriately scoped GitHub credential using the client's secure authentication mechanism. Confirm the client actually supports custom bearer authentication before proceeding.
3. Call `gh_preflight` with `{"live":true}`. Require `graphql`, `projectsRead`, `projectsWrite` and `issuePr` to be ready. The report does not replace a permissions test for each operation.
4. Call `gh_project_list` for owner `EMBLEM-NLP`. Check for an existing `ElevenLabs — Application MVP Delivery` board before any mutation.
5. Read `EMBLEM-NLP/portfolio-ops/docs/projects-schema.md` and reconcile the approved fields/views; avoid the browser-only `groupBy` option in hosted mode.
6. Create or link the organization board and add the three existing portfolio-ops issues (#1–#3). Validate board URL, permissions, field IDs and item presence.
7. Record results in portfolio-ops issue #3 and link the board from issue #1.

## Go/no-go
Do not perform board writes if authorization, client connectivity, project identity, or existing-board detection is uncertain. Never log bearer tokens. Do not automatically create bulk issues.

## Validation status
This runbook and container packaging require CI/build verification. No live hosted endpoint or Projects mutation has been verified by this document.
