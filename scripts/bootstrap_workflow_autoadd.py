from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent.parent


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


# Server registration and release version.
path = ROOT / 'server.mjs'
text = path.read_text()
text = replace_once(
    text,
    "import { registerIssueLifecycleTools } from './lib/tools-issue-lifecycle.mjs';",
    "import { registerIssueLifecycleTools } from './lib/tools-issue-lifecycle.mjs';\nimport { registerWorkflowTools } from './lib/tools-workflows.mjs';",
    'server workflow import',
)
text = replace_once(
    text,
    "const server = new McpServer({ name: 'gh-projects-mcp', version: '1.7.0' });",
    "const server = new McpServer({ name: 'gh-projects-mcp', version: '1.8.0' });",
    'server version',
)
text = replace_once(
    text,
    "registerPrTools(server);\nregisterIssueLifecycleTools(server);",
    "registerPrTools(server);\nregisterIssueLifecycleTools(server);\nregisterWorkflowTools(server);",
    'server workflow registration',
)
path.write_text(text)

# Export DOM helpers so unit tests directly lock the clear/verify behavior.
path = ROOT / 'lib/tools-workflows.mjs'
text = path.read_text()
text = replace_once(text, 'async function setWorkflowFilter(page, filterText = \'\') {', 'export async function setWorkflowFilter(page, filterText = \'\') {', 'export setWorkflowFilter')
text = replace_once(text, 'async function readWorkflowVerification(page, repo, expectedFilter) {', 'export async function readWorkflowVerification(page, repo, expectedFilter) {', 'export readWorkflowVerification')
path.write_text(text)

# Package/plugin versions.
path = ROOT / 'package.json'
data = json.loads(path.read_text())
data['version'] = '1.8.0'
path.write_text(json.dumps(data, indent=2) + '\n')

for rel in ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']:
    path = ROOT / rel
    data = json.loads(path.read_text())
    data['version'] = '1.8.0'
    path.write_text(json.dumps(data, indent=2) + '\n')

for rel in ['skills/gh-project-manage/SKILL.md', '.claude/skills/gh-project-manage/SKILL.md']:
    path = ROOT / rel
    text = path.read_text()
    text = replace_once(text, 'version: 1.7.0', 'version: 1.8.0', f'{rel} version')
    path.write_text(text)

# Canonical skill routing + browser semantics.
path = ROOT / 'skills/gh-project-manage/SKILL.md'
text = path.read_text()
text = replace_once(
    text,
    '| List/create/edit/delete project views | `gh_project_views_list`, `gh_project_view_create`, `gh_project_view_edit`, `gh_project_view_delete` |',
    '| List/create/edit/delete project views | `gh_project_views_list`, `gh_project_view_create`, `gh_project_view_edit`, `gh_project_view_delete` |\n| Configure auto-add workflow | `gh_project_workflow_autoadd_configure` — browser-only; omitting `filter` clears any existing filter |',
    'skill workflow route',
)
text = replace_once(
    text,
    '- If `groupBy` is requested and the browser capability is unavailable, report that limitation; do not silently drop the requested grouping.',
    '- If `groupBy` is requested and the browser capability is unavailable, report that limitation; do not silently drop the requested grouping.\n- `gh_project_workflow_autoadd_configure` is explicitly `browser-ui` only. It always writes the desired filter state: omitting `filter` clears an existing filter, and success requires post-save verification of both repository and filter.',
    'skill browser workflow guidance',
)
path.write_text(text)

# README release/tool/docs.
path = ROOT / 'README.md'
text = path.read_text()
text = replace_once(text, '**Version 1.7.0**', '**Version 1.8.0**', 'readme version')
text = replace_once(
    text,
    '| `gh_project_view_delete` | Delete a view via GraphQL (confirm-gated) |',
    '| `gh_project_view_delete` | Delete a view via GraphQL (confirm-gated) |\n| `gh_project_workflow_autoadd_configure` | Configure UI-only Auto-add workflow; omitted filter explicitly clears the saved filter and repo+filter are re-verified |',
    'readme workflow tool row',
)
text = replace_once(
    text,
    '- Microsoft Edge signed into github.com only when using an explicitly browser-backed capability such as view `groupBy` or UI-only Insights tooling',
    '- Microsoft Edge signed into github.com only when using an explicitly browser-backed capability such as view `groupBy`, `gh_project_workflow_autoadd_configure`, or UI-only Insights tooling',
    'readme browser requirement',
)
text = replace_once(
    text,
    'Two broad GitHub Projects areas still need additional tooling: **Insights chart authoring** remains UI-driven, and project **workflow authoring** (auto-add/auto-archive) remains UI-only apart from `deleteProjectV2Workflow`. View CRUD itself is API-backed; optional view `groupBy` still uses the isolated browser fallback. Iteration/sprint config and date-setting are API-backed and covered.',
    'Two broad GitHub Projects areas still need additional tooling: **Insights chart authoring** remains UI-driven, and project **workflow authoring beyond the covered Auto-add workflow** (for example auto-archive and other workflow types) remains UI-only apart from `deleteProjectV2Workflow`. `gh_project_workflow_autoadd_configure` covers Auto-add through the browser and verifies both repository and filter after save. View CRUD itself is API-backed; optional view `groupBy` still uses the isolated browser fallback. Iteration/sprint config and date-setting are API-backed and covered.',
    'readme not-yet-covered',
)
path.write_text(text)

# Claude execution-agent guidance must not keep calling Auto-add uncovered.
path = ROOT / '.claude/agents/gh-project-manager.md'
text = path.read_text()
text = replace_once(
    text,
    '(Insights charts, workflow authoring — see "Not yet in the MCP" below).',
    '(Insights charts and workflow authoring beyond the covered Auto-add tool — see "Not yet in the MCP" below).',
    'agent hierarchy workflow note',
)
text = replace_once(
    text,
    'features the MCP does not cover (for example Insights authoring).',
    'features the MCP does not cover (for example Insights authoring or workflow types other than the covered Auto-add tool).',
    'agent playwright guidance',
)
text = replace_once(
    text,
    '- Project workflow *authoring* (auto-add / auto-archive) — only `deleteProjectV2Workflow` has an API',
    '- Project workflow authoring beyond Auto-add (for example auto-archive) — only `deleteProjectV2Workflow` has an API; Auto-add is covered by `gh_project_workflow_autoadd_configure`',
    'agent not-yet workflow bullet',
)
text = replace_once(
    text,
    'Now covered by `gh-projects-mcp` tools (no longer "not yet" — the earlier note mislabeled these\nas UI-only; both are API-backed):',
    'Now covered by `gh-projects-mcp` tools (no longer "not yet"):\n- Auto-add workflow configuration → `gh_project_workflow_autoadd_configure` (browser-only; omission clears any existing filter and repo+filter are both verified)\n\nThe following earlier items were also mislabeled as UI-only; both are API-backed:',
    'agent covered workflow section',
)
path.write_text(text)

print('workflow auto-add integration applied')
