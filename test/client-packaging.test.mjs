import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const json = (path) => JSON.parse(readFileSync(join(repoRoot, path), 'utf8'));

const pkg = json('package.json');
const claude = json('.claude-plugin/plugin.json');
const codex = json('.codex-plugin/plugin.json');
const mcp = json('.mcp.json');
const contract = json('contracts/tools.json');
const skill = readFileSync(join(repoRoot, 'skills/gh-project-manage/SKILL.md'), 'utf8');

function skillVersion(markdown) {
  const match = markdown.match(/^version:\s*([^\s]+)\s*$/m);
  return match?.[1];
}

test('package, Claude, Codex, canonical skill, and tool contract versions stay aligned', () => {
  assert.equal(claude.version, pkg.version);
  assert.equal(codex.version, pkg.version);
  assert.equal(skillVersion(skill), pkg.version);
  assert.equal(contract.serverVersion, pkg.version);
});

test('Claude and Codex packages both point at the canonical shared skill', () => {
  assert.deepEqual(claude.skills, ['../skills/gh-project-manage/SKILL.md']);
  assert.equal(codex.skills, './skills/');
  assert.match(skill, /canonical, client-neutral skill/);
});

test('Codex plugin launches the same server.mjs over stdio from plugin root', () => {
  assert.equal(codex.mcpServers, './.mcp.json');
  const server = mcp.mcpServers?.['gh-projects'];
  assert.ok(server, 'expected gh-projects entry in .mcp.json');
  assert.equal(server.command, 'node');
  assert.deepEqual(server.args, ['server.mjs']);
  assert.equal(server.cwd, '.');
});

test('Codex MCP explicitly permits both backend selection and GitHub credential env vars', () => {
  const vars = new Set(mcp.mcpServers['gh-projects'].env_vars ?? []);
  for (const name of [
    'GH_PROJECTS_BACKEND',
    'GH_PROJECTS_TOKEN',
    'GITHUB_TOKEN',
    'GH_PROJECTS_API_URL',
    'GH_PROJECTS_GRAPHQL_URL',
  ]) {
    assert.ok(vars.has(name), `missing ${name} from Codex MCP env_vars`);
  }
});

test('Codex plugin metadata identifies the same plugin and declares interactive read/write capability', () => {
  assert.equal(codex.name, pkg.name);
  assert.equal(codex.interface.displayName, 'GitHub Projects Manager');
  const capabilities = new Set(codex.interface.capabilities ?? []);
  for (const capability of ['Interactive', 'Read', 'Write']) {
    assert.ok(capabilities.has(capability), `missing Codex capability ${capability}`);
  }
});
