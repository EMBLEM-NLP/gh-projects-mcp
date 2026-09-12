import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Every gh_* tool name referenced by the canonical cross-client skill router.
function skillReferencedTools() {
  const md = readFileSync(join(repoRoot, 'skills/gh-project-manage/SKILL.md'), 'utf8');
  return new Set(md.match(/gh_[a-z_]+/g) ?? []);
}

// Every tool actually registered, parsed from the first string arg of each
// server.tool(...) call across the server and its tool modules.
function registeredTools() {
  const files = ['server.mjs', 'lib/tools-views-graphql.mjs', 'lib/tools-pr.mjs'];
  const names = new Set();
  for (const f of files) {
    const src = readFileSync(join(repoRoot, f), 'utf8');
    for (const m of src.matchAll(/server\.tool\(\s*['"]([^'"]+)['"]/g)) {
      names.add(m[1]);
    }
  }
  return names;
}

test('every tool the canonical skill router references is registered in the server', () => {
  const referenced = skillReferencedTools();
  const registered = registeredTools();
  assert.ok(referenced.size > 0, 'expected the canonical SKILL.md router to reference some gh_* tools');
  const orphans = [...referenced].filter((t) => !registered.has(t));
  assert.deepEqual(orphans, [], `canonical SKILL.md references tools not registered in the server: ${orphans.join(', ')}`);
});

test('the Claude delegation subagent file exists', () => {
  const agentPath = join(repoRoot, '.claude/agents/gh-project-manager.md');
  assert.ok(existsSync(agentPath), `missing delegation subagent at ${agentPath}`);
});

test('the Claude repo-local skill is only a shim to the canonical skill', () => {
  const shim = readFileSync(join(repoRoot, '.claude/skills/gh-project-manage/SKILL.md'), 'utf8');
  assert.match(shim, /skills\/gh-project-manage\/SKILL\.md/);
  assert.match(shim, /Do not add workflow\/tool instructions here/);
});

test('sanity: the gh_pr_* tools are registered', () => {
  const registered = registeredTools();
  for (const t of ['gh_pr_create', 'gh_pr_list', 'gh_pr_merge']) {
    assert.ok(registered.has(t), `expected ${t} to be registered`);
  }
});
