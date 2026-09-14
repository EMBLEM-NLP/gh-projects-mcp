#!/usr/bin/env node
// Renders contracts/tools.json (the generated, CI-verified tool contract — see
// `npm run contract:write` / `contract:verify` in scripts/tool-contract.mjs)
// into a human-readable docs/TOOL_INVENTORY.md. The contract is the source of
// truth; this script never talks to the live server, so it always reflects
// exactly what's committed.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contractPath = resolve(repoRoot, 'contracts', 'tools.json');
const outPath = resolve(repoRoot, 'docs', 'TOOL_INVENTORY.md');

const CATEGORIES = [
  { title: 'Auth & diagnostics', match: (n) => n === 'gh_auth_status' || n === 'gh_preflight' },
  { title: 'Projects', match: (n) => /^gh_project_(list|view|create|edit|delete|copy|unlink|mark_template|link)$/.test(n) },
  { title: 'Project fields', match: (n) => n.startsWith('gh_project_field_') || n === 'gh_project_iteration_configure' },
  { title: 'Project items', match: (n) => n.startsWith('gh_project_item_') || n === 'gh_project_draft_edit' || n === 'gh_project_draft_convert' },
  { title: 'Project views', match: (n) => n.startsWith('gh_project_view') },
  { title: 'Project workflows', match: (n) => n.startsWith('gh_project_workflow_') },
  { title: 'Issues', match: (n) => n.startsWith('gh_issue_') },
  { title: 'Pull requests', match: (n) => n.startsWith('gh_pr_') },
  { title: 'Labels', match: (n) => n.startsWith('gh_label_') },
  { title: 'Sub-issues', match: (n) => n.startsWith('gh_subissue_') },
  { title: 'Status updates', match: (n) => n.startsWith('gh_status_update_') },
];

function categorize(name) {
  return CATEGORIES.find((c) => c.match(name))?.title ?? 'Other';
}

function requiredParams(tool) {
  const props = tool.inputSchema?.properties ?? {};
  const required = new Set(tool.inputSchema?.required ?? []);
  const names = Object.keys(props);
  if (names.length === 0) return '_none_';
  return names
    .map((n) => (required.has(n) ? `\`${n}\`` : `\`${n}\`?`))
    .join(', ');
}

function extraCapabilities(tool) {
  return (tool.capabilities ?? []).filter((c) => c !== 'github');
}

function render(manifest) {
  const lines = [];
  lines.push('# gh-projects-mcp tool inventory');
  lines.push('');
  lines.push('Generated from [`contracts/tools.json`](../contracts/tools.json) by');
  lines.push('`node scripts/render-tool-inventory.mjs` — do not hand-edit. Regenerate with');
  lines.push('`npm run contract:write && npm run docs:tools` whenever the tool contract');
  lines.push('changes, and check both files in together.');
  lines.push('');
  lines.push(`- Server: \`${manifest.server}\` v${manifest.serverVersion}`);
  lines.push(`- Tool count: ${manifest.toolCount}`);
  lines.push(
    `- Confirm-gated (destructive, require \`confirm: true\`): ${manifest.tools.filter((t) => t.confirmationRequired).length}`,
  );
  lines.push('');
  lines.push('Params marked `?` are optional; the rest are required. ⚠️ marks a tool that');
  lines.push('requires `confirm: true` because it is destructive or irreversible.');
  lines.push('');

  const byCategory = new Map();
  for (const tool of manifest.tools) {
    const cat = categorize(tool.name);
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(tool);
  }

  for (const cat of CATEGORIES.map((c) => c.title)) {
    const tools = byCategory.get(cat);
    if (!tools) continue;
    lines.push(`## ${cat}`);
    lines.push('');
    for (const tool of tools) {
      const badge = tool.confirmationRequired ? ' ⚠️' : '';
      const caps = extraCapabilities(tool);
      const capsNote = caps.length ? ` _(requires: ${caps.join(', ')})_` : '';
      lines.push(`### \`${tool.name}\`${badge}${capsNote}`);
      lines.push('');
      lines.push(tool.description || '_no description_');
      lines.push('');
      lines.push(`Params: ${requiredParams(tool)}`);
      lines.push('');
    }
  }

  const other = byCategory.get('Other');
  if (other) {
    lines.push('## Other');
    lines.push('');
    for (const tool of other) {
      lines.push(`### \`${tool.name}\``);
      lines.push('');
      lines.push(tool.description || '_no description_');
      lines.push('');
      lines.push(`Params: ${requiredParams(tool)}`);
      lines.push('');
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

const manifest = JSON.parse(readFileSync(contractPath, 'utf8'));
writeFileSync(outPath, render(manifest), 'utf8');
process.stdout.write(`Wrote ${manifest.toolCount}-tool inventory to docs/TOOL_INVENTORY.md.\n`);
