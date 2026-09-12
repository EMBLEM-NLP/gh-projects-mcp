import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

test('workflow auto-add configure is advertised as browser-ui only', () => {
  const contract = JSON.parse(readFileSync(join(repoRoot, 'contracts/tools.json'), 'utf8'));
  const tool = contract.tools.find((entry) => entry.name === 'gh_project_workflow_autoadd_configure');
  assert.ok(tool, 'expected workflow auto-add tool in committed contract');
  assert.deepEqual(tool.capabilities, ['browser-ui']);
});

test('normal view CRUD remains API-capable with only groupBy marked as browser fallback', () => {
  const contract = JSON.parse(readFileSync(join(repoRoot, 'contracts/tools.json'), 'utf8'));
  for (const name of ['gh_project_view_create', 'gh_project_view_edit']) {
    const tool = contract.tools.find((entry) => entry.name === name);
    assert.ok(tool, `expected ${name} in contract`);
    assert.deepEqual(tool.capabilities, ['github', 'browser-ui:groupBy']);
  }
});
