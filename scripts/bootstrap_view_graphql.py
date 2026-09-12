from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent.parent


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def replace_between(text: str, start: str, end: str, replacement: str, label: str) -> str:
    start_index = text.find(start)
    if start_index < 0:
        raise RuntimeError(f"{label}: start marker not found")
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise RuntimeError(f"{label}: end marker not found")
    return text[:start_index] + replacement + text[end_index:]


# ── server.mjs ────────────────────────────────────────────────────────────────
server_path = ROOT / 'server.mjs'
server = server_path.read_text()
server = replace_once(
    server,
    " * Thin wrappers over `gh project` / `gh issue` / `gh label` and the GraphQL\n * API, plus Playwright/CDP-driven view management (GitHub's API has no\n * createProjectV2View mutation — view creation is web-UI only).",
    " * Thin wrappers over GitHub REST/GraphQL and the local `gh` CLI compatibility\n * backend. Project view create/edit/delete are GraphQL-backed; only optional\n * view settings that GitHub still omits from GraphQL (currently groupBy) use CDP.",
    'server header',
)
server = replace_once(
    server,
    "import { registerViewTools } from './lib/tools-views.mjs';",
    "import { registerViewTools } from './lib/tools-views-graphql.mjs';\nimport { VIEW_SELECTION, normalizeView } from './lib/view-api.mjs';",
    'view tools import',
)
server = replace_once(
    server,
    "const server = new McpServer({ name: 'gh-projects-mcp', version: '1.5.0' });",
    "const server = new McpServer({ name: 'gh-projects-mcp', version: '1.6.0' });",
    'server version',
)
server = replace_once(
    server,
    "      const q = `{ ${root}(login: \\\"${gqlStr(owner)}\\\") { projectV2(number: ${number}) { createdAt updatedAt views(first: 20) { nodes { name number createdAt layout } } } } }`;\n      const vr = gql(q);\n      views = vr.data[root]?.projectV2?.views?.nodes ?? [];",
    "      const q = `{ ${root}(login: \\\"${gqlStr(owner)}\\\") { projectV2(number: ${number}) { createdAt updatedAt views(first: 100) { nodes { ${VIEW_SELECTION} } } } } }`;\n      const vr = gql(q);\n      views = (vr.data[root]?.projectV2?.views?.nodes ?? []).map(normalizeView);",
    'project view enriched query',
)

views_block = r'''// ── Views (GraphQL-backed; optional groupBy remains a UI fallback) ─────────────

server.tool(
  'gh_project_views_list',
  'List a project\'s views with stable node IDs, layout, filter, ordered visible fields, and current group-by configuration.',
  {
    owner: z.string().describe('Project owner login'),
    number: z.number().describe('Project number'),
  },
  async ({ owner, number }) => safe(() => {
    const root = ownerRoot(owner);
    const q = `{ ${root}(login: "${gqlStr(owner)}") { projectV2(number: ${number}) { views(first: 100) { nodes { ${VIEW_SELECTION} } } } } }`;
    const r = gql(q);
    return text((r.data[root]?.projectV2?.views?.nodes ?? []).map(normalizeView));
  }),
);

'''
server = replace_between(
    server,
    '// ── Views (read-only — creation/layout requires Playwright, see tools-views.mjs) ──',
    '// ── Issues & labels ──────────────────────────────────────────────────────────',
    views_block,
    'views list block',
)
server_path.write_text(server)

# ── view-api roadmap validation ───────────────────────────────────────────────
view_api_path = ROOT / 'lib/view-api.mjs'
view_api = view_api_path.read_text()
view_api = replace_once(
    view_api,
    "    const graphLayout = VIEW_LAYOUT_TO_GRAPHQL[layout];\n    if (!graphLayout) throw new Error(`Unsupported view layout: ${layout}.`);",
    "    const graphLayout = VIEW_LAYOUT_TO_GRAPHQL[layout];\n    if (!graphLayout) throw new Error(`Unsupported view layout: ${layout}.`);\n    if (graphLayout === 'ROADMAP_LAYOUT' && visibleFieldIds !== undefined) {\n      throw new Error('visibleFieldIds is not applicable to roadmap views.');\n    }",
    'roadmap create validation',
)
view_api = replace_once(
    view_api,
    "    const { view: current } = findView(owner, number, { viewId, viewName });\n    const parts = [`viewId: \\\"${gqlStr(current.id)}\\\"`];",
    "    const { view: current } = findView(owner, number, { viewId, viewName });\n    const targetLayout = layout === undefined ? current.layout : VIEW_LAYOUT_TO_GRAPHQL[layout];\n    if (targetLayout === 'ROADMAP_LAYOUT' && visibleFieldIds !== undefined) {\n      throw new Error('visibleFieldIds is not applicable to roadmap views.');\n    }\n    const parts = [`viewId: \\\"${gqlStr(current.id)}\\\"`];",
    'roadmap update validation',
)
view_api_path.write_text(view_api)

# ── CDP comments ──────────────────────────────────────────────────────────────
cdp_path = ROOT / 'lib/cdp.mjs'
cdp = cdp_path.read_text()
cdp = replace_once(
    cdp,
    " * Shared Edge/CDP helpers for Playwright-driven GitHub automation.\n * GitHub Projects v2's GraphQL API does not expose view creation/layout\n * mutations, so view management drives the web UI directly via an\n * existing, already-logged-in Edge profile (CDP attach, not a fresh\n * headless browser).",
    " * Shared Edge/CDP helpers for the small set of GitHub UI capabilities that\n * still lack a supported GraphQL mutation. Ordinary Project view CRUD is now\n * API-backed; the view layer uses CDP only for optional groupBy configuration\n * (plus separate future UI-only features such as Insights authoring).",
    'cdp header',
)
cdp_path.write_text(cdp)

# ── canonical skill ───────────────────────────────────────────────────────────
skill_path = ROOT / 'skills/gh-project-manage/SKILL.md'
skill = skill_path.read_text()
skill = replace_once(skill, 'version: 1.5.0', 'version: 1.6.0', 'canonical skill version')
skill = replace_once(
    skill,
    '| List/create/delete project views | `gh_project_views_list`, `gh_project_view_create`, `gh_project_view_delete` |',
    '| List/create/edit/delete project views | `gh_project_views_list`, `gh_project_view_create`, `gh_project_view_edit`, `gh_project_view_delete` |',
    'skill view routing',
)
skill = replace_between(
    skill,
    '## Views and browser capability',
    '## PR-first code workflow',
    '''## Views and browser capability\n\nOrdinary Project view CRUD is API-backed: create, rename, layout, filter, ordered visible fields, and delete do not require a browser.\n\n- `gh_project_view_create` is declarative and GraphQL-backed for ordinary settings.\n- `gh_project_view_edit` updates one view by name through `updateProjectV2View`.\n- `gh_project_view_delete` uses `deleteProjectV2View` and remains confirm-gated.\n- The optional `groupBy` input is currently the only view setting that falls back to the existing logged-in Edge/CDP capability because GitHub's GraphQL view mutation input does not expose group-by fields.\n- A request that does not contain `groupBy` must never require or launch Edge.\n- If `groupBy` is requested and the browser capability is unavailable, report that limitation; do not silently drop the requested grouping.\n\n''',
    'skill views section',
)
skill_path.write_text(skill)

# Claude compatibility shim version follows the shared skill/package release.
shim_path = ROOT / '.claude/skills/gh-project-manage/SKILL.md'
shim = shim_path.read_text().replace('version: 1.4.0', 'version: 1.6.0', 1)
shim_path.write_text(shim)

# ── Claude subagent ───────────────────────────────────────────────────────────
agent_path = ROOT / '.claude/agents/gh-project-manager.md'
agent = agent_path.read_text()
agent = agent.replace('version: 1.1.0', 'version: 1.2.0', 1).replace('lastmod: 2026-07-21', 'lastmod: 2026-09-12', 1)
agent = replace_once(
    agent,
    "4. **Playwright, ad hoc** — should rarely be needed. `gh_project_view_create`/`gh_project_view_delete`\n   already cover view creation/repair via CDP-attached Edge. Only reach for raw Playwright if a task\n   needs UI automation those tools don't cover (e.g. Insights charts — see below).",
    "4. **Playwright, ad hoc** — should rarely be needed. Normal view CRUD is GraphQL-backed through\n   `gh_project_view_create` / `gh_project_view_edit` / `gh_project_view_delete`; only optional `groupBy`\n   uses the MCP's isolated Edge/CDP fallback. Reach for raw Playwright only for genuinely UI-only\n   features the MCP does not cover (for example Insights authoring).",
    'agent tool hierarchy',
)
agent = replace_once(
    agent,
    "6. **No billing banner** — if you load the project page via `gh_project_view_create`'s Playwright\n   path for any other reason, note if a payment-issue banner is visible; project automations can\n   fail silently behind one. Out of scope to fix — surface it, don't act on it.",
    "6. **Browser-only anomalies** — only when a workflow actually uses the optional UI fallback\n   (for example view `groupBy` or an Insights playbook), surface blocking authentication/billing\n   banners. Normal view CRUD should not open the browser just to perform this check.",
    'agent audit browser point',
)
agent_path.write_text(agent)

# ── README ────────────────────────────────────────────────────────────────────
readme_path = ROOT / 'README.md'
readme = readme_path.read_text()
readme = readme.replace('**Version 1.4.0**', '**Version 1.6.0**', 1)
readme = replace_between(
    readme,
    '## Why this exists',
    '## Tools',
    '''## Why this exists\n\nGitHub Projects has a broad GraphQL/REST API, but client/runtime ergonomics still vary. This server\nprovides one stable MCP contract over local `gh` CLI auth or direct GitHub API auth and preserves\nconfirmation gates and ID-resolution rules across Claude, Codex, and future remote clients.\n\nProject view create/update/delete are now GraphQL-backed. The only view setting that still requires\nthe existing logged-in Edge/CDP fallback is optional `groupBy`, because GitHub's current GraphQL\nview mutation input exposes name/layout/filter/ordered visible fields but not group-by fields.\n\n''',
    'README why',
)
readme = readme.replace('| `gh_project_field_create` | Create a custom field |', '| `gh_project_field_create` | Create TEXT/NUMBER/DATE/SINGLE_SELECT/MULTI_SELECT/ITERATION fields |', 1)
readme = readme.replace('| `gh_project_field_option_update` | Add/rename/recolor SINGLE_SELECT options (delete-guarded) |', '| `gh_project_field_option_update` | Safely update SINGLE_SELECT/MULTI_SELECT options with ID preservation |', 1)
readme = readme.replace('| `gh_project_views_list` | List views (read-only, GraphQL) |\n| `gh_project_view_create` | Create/repair views (Playwright — see above) |\n| `gh_project_view_delete` | Delete a view (Playwright) |', '| `gh_project_views_list` | List views with IDs/filter/layout/visible/grouping configuration |\n| `gh_project_view_create` | Declaratively create/reconcile views (GraphQL; optional groupBy UI fallback) |\n| `gh_project_view_edit` | Edit one view (GraphQL; optional groupBy UI fallback) |\n| `gh_project_view_delete` | Delete a view via GraphQL (confirm-gated) |', 1)
readme = replace_once(
    readme,
    "- [`gh` CLI](https://cli.github.com/), authenticated with the `project` scope\n  (`gh auth refresh -s project`)\n- Node.js 18+\n- For view management: Microsoft Edge, signed into github.com (the Playwright automation attaches\n  to this session via Chrome DevTools Protocol rather than launching a fresh browser)",
    "- Node.js 18+\n- GitHub authentication through either direct API mode (`GH_PROJECTS_TOKEN` / `GITHUB_TOKEN`) or the local [`gh` CLI](https://cli.github.com/) backend with project scope\n- Microsoft Edge signed into github.com only when using an explicitly browser-backed capability such as view `groupBy` or UI-only Insights tooling",
    'README requirements',
)
readme = readme.replace('`gh_project_view_delete`) drives the actual GitHub web UI via Playwright, CDP-attached to your\nexisting logged-in Edge browser session (not a fresh headless browser).\n\n', '', 1)
readme = readme.replace('- `.claude/skills/gh-project-manage/SKILL.md` — front-door skill; routes simple asks to a single\n  tool call, delegates multi-step work to the subagent below.', '- `skills/gh-project-manage/SKILL.md` — canonical Claude/Codex front-door skill; the `.claude/skills/...` path is a compatibility shim.', 1)
readme = replace_once(
    readme,
    "Two GitHub Projects features are genuinely UI-only (no API) and remain unported: **Insights chart**\ncreation/rename, and project **workflow authoring** (auto-add/auto-archive — only\n`deleteProjectV2Workflow` has an API). Both need Playwright/CDP like the view tools. (Iteration/sprint\nconfig and date-setting are API-backed and *are* covered — `gh_project_iteration_configure` /\n`gh_project_item_edit`.)",
    "Two broad GitHub Projects areas still need additional tooling: **Insights chart authoring** remains UI-driven, and project **workflow authoring** (auto-add/auto-archive) remains UI-only apart from `deleteProjectV2Workflow`. View CRUD itself is API-backed; optional view `groupBy` still uses the isolated browser fallback. Iteration/sprint config and date-setting are API-backed and covered.",
    'README not covered',
)
readme_path.write_text(readme)

# ── Codex docs ────────────────────────────────────────────────────────────────
codex_path = ROOT / 'docs/CODEX.md'
codex = codex_path.read_text()
codex = replace_between(
    codex,
    '## Browser-only capability',
    '## Remote/hosted Codex',
    '''## Browser-only capability\n\nNormal Project view create/edit/delete is GraphQL-backed and works in the same API/CLI runtimes as other Project operations. The contract marks `gh_project_view_create` and `gh_project_view_edit` with an optional `browser-ui:groupBy` capability because only the `groupBy` input still requires the logged-in Edge/CDP fallback. `gh_project_view_delete` is fully API-backed.\n\nRemote runtimes that do not expose a browser can still use every API-backed view setting; they should avoid requesting `groupBy` until a non-browser mutation becomes available. Runtime isolation/preflight work is tracked in #64.\n\n''',
    'Codex browser section',
)
codex_path.write_text(codex)

# ── Tool contract capability tags ─────────────────────────────────────────────
contract_script_path = ROOT / 'scripts/tool-contract.mjs'
contract_script = contract_script_path.read_text()
contract_script = replace_once(
    contract_script,
    "function capabilityTags(name) {\n  if (name === 'gh_project_view_create' || name === 'gh_project_view_delete') {\n    return ['browser-ui'];\n  }\n  return ['github'];\n}",
    "function capabilityTags(name) {\n  if (name === 'gh_project_view_create' || name === 'gh_project_view_edit') {\n    return ['github', 'browser-ui:groupBy'];\n  }\n  return ['github'];\n}",
    'contract capability tags',
)
contract_script_path.write_text(contract_script)

# ── Skill router source discovery ─────────────────────────────────────────────
router_test_path = ROOT / 'test/skill-router.test.mjs'
router_test = router_test_path.read_text()
router_test = replace_once(
    router_test,
    "  const files = ['server.mjs', 'lib/tools-views.mjs', 'lib/tools-pr.mjs'];",
    "  const files = ['server.mjs', 'lib/tools-views-graphql.mjs', 'lib/tools-pr.mjs'];",
    'skill router tool modules',
)
router_test_path.write_text(router_test)

# ── Versions ──────────────────────────────────────────────────────────────────
for relative in ['package.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json']:
    path = ROOT / relative
    data = json.loads(path.read_text())
    data['version'] = '1.6.0'
    path.write_text(json.dumps(data, indent=2) + '\n')

print('GraphQL view migration bootstrap applied')
