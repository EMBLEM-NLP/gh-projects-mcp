from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent.parent

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)

server_path = ROOT / 'server.mjs'
server = server_path.read_text()
server = replace_once(
    server,
    "import { registerPrTools } from './lib/tools-pr.mjs';",
    "import { registerPrTools } from './lib/tools-pr.mjs';\nimport { registerIssueLifecycleTools } from './lib/tools-issue-lifecycle.mjs';",
    'issue lifecycle import',
)
server = replace_once(
    server,
    "const server = new McpServer({ name: 'gh-projects-mcp', version: '1.6.0' });",
    "const server = new McpServer({ name: 'gh-projects-mcp', version: '1.7.0' });",
    'server version',
)
server = replace_once(
    server,
    "registerViewTools(server);\nregisterPrTools(server);",
    "registerViewTools(server);\nregisterPrTools(server);\nregisterIssueLifecycleTools(server);",
    'tool registration',
)
server_path.write_text(server)

backend_path = ROOT / 'lib/github-backend.mjs'
backend = backend_path.read_text()
backend = replace_once(
    backend,
    "        'issue create',\n        'issue list',",
    "        'issue create',\n        'issue list',\n        'issue edit',\n        'issue close',\n        'issue reopen',",
    'backend capability list',
)
backend_path.write_text(backend)

package_path = ROOT / 'package.json'
package = json.loads(package_path.read_text())
package['version'] = '1.7.0'
package_path.write_text(json.dumps(package, indent=2) + '\n')

for rel in ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']:
    path = ROOT / rel
    data = json.loads(path.read_text())
    data['version'] = '1.7.0'
    path.write_text(json.dumps(data, indent=2) + '\n')

for rel in ['skills/gh-project-manage/SKILL.md', '.claude/skills/gh-project-manage/SKILL.md']:
    path = ROOT / rel
    text = path.read_text()
    text = replace_once(text, 'version: 1.6.0', 'version: 1.7.0', f'{rel} version')
    path.write_text(text)

skill_path = ROOT / 'skills/gh-project-manage/SKILL.md'
skill = skill_path.read_text()
skill = replace_once(
    skill,
    '| Create/list repo issues | `gh_issue_create`, `gh_issue_list` |',
    '| Create/list/edit/close repo issues | `gh_issue_create`, `gh_issue_list`, `gh_issue_edit`, `gh_issue_close` — close is confirm-gated |',
    'skill issue routing',
)
skill = replace_once(
    skill,
    '- Never delete projects, fields, items, views, status updates, or merge PRs without the user\'s explicit authorization and the tool\'s confirmation gate.',
    '- Never delete projects, fields, items, views, status updates, close issues, or merge PRs without the user\'s explicit authorization and the tool\'s confirmation gate.',
    'skill safety',
)
skill_path.write_text(skill)

readme_path = ROOT / 'README.md'
readme = readme_path.read_text()
if '**Version 1.6.0**' in readme:
    readme = readme.replace('**Version 1.6.0**', '**Version 1.7.0**', 1)
readme = replace_once(
    readme,
    '| `gh_issue_list` | List issues (includes GraphQL node `id`) |',
    '| `gh_issue_list` | List issues (includes GraphQL node `id`) |\n| `gh_issue_edit` | Edit issue title/body/labels or reopen/close; close is confirm-gated |\n| `gh_issue_close` | Close an issue with completed/not-planned reason (confirm-gated) |',
    'readme issue tools',
)
readme_path.write_text(readme)

print('issue lifecycle bootstrap applied')
