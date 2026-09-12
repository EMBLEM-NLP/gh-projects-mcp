import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = resolve(repoRoot, 'server.mjs');
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
const contractPath = resolve(repoRoot, 'contracts', 'tools.json');

function cleanEnv(extra = {}) {
  return Object.fromEntries(
    Object.entries({ ...process.env, ...extra })
      .filter(([, value]) => typeof value === 'string'),
  );
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, normalize(child)]),
  );
}

function capabilityTags(name) {
  if (name === 'gh_project_view_create' || name === 'gh_project_view_edit') {
    return ['github', 'browser-ui:groupBy'];
  }
  if (name === 'gh_project_workflow_autoadd_configure') {
    return ['browser-ui'];
  }
  return ['github'];
}

function contractTool(tool) {
  const required = tool.inputSchema?.required ?? [];
  const confirmRequired = required.includes('confirm');
  const entry = {
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: normalize(tool.inputSchema ?? {}),
    destructive: confirmRequired,
    confirmationRequired: confirmRequired,
    capabilities: capabilityTags(tool.name),
  };
  if (tool.outputSchema) entry.outputSchema = normalize(tool.outputSchema);
  return entry;
}

async function listTools(mode) {
  const env = cleanEnv({
    GH_PROJECTS_BACKEND: mode,
    ...(mode === 'api' ? { GH_PROJECTS_TOKEN: 'contract-test-placeholder' } : {}),
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: repoRoot,
    env,
    stderr: 'pipe',
  });
  const client = new Client({ name: `gh-projects-contract-${mode}`, version: '1.0.0' });
  try {
    await client.connect(transport);
    const response = await client.listTools();
    return response.tools.map(contractTool).sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    await client.close();
  }
}

function manifest(tools) {
  return normalize({
    schemaVersion: 1,
    server: 'gh-projects-mcp',
    serverVersion: packageJson.version,
    toolCount: tools.length,
    tools,
  });
}

function serialized(value) {
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

function assertEqual(label, left, right) {
  const a = serialized(left);
  const b = serialized(right);
  if (a !== b) {
    throw new Error(`${label} differ. Regenerate/inspect the tool contract before merging.`);
  }
}

async function main() {
  const command = process.argv[2] ?? 'check';
  const cliTools = await listTools('gh-cli');
  const apiTools = await listTools('api');
  assertEqual('gh-cli and api tools/list contracts', cliTools, apiTools);
  const current = manifest(cliTools);

  if (command === 'check') {
    process.stdout.write(`Tool parity OK: ${current.toolCount} tools exposed identically by gh-cli and api backends.\n`);
    return;
  }

  if (command === 'write') {
    mkdirSync(dirname(contractPath), { recursive: true });
    writeFileSync(contractPath, serialized(current), 'utf8');
    process.stdout.write(`Wrote ${current.toolCount}-tool contract to contracts/tools.json.\n`);
    return;
  }

  if (command === 'verify') {
    const expected = JSON.parse(readFileSync(contractPath, 'utf8'));
    assertEqual('Committed and live MCP tool contracts', expected, current);
    process.stdout.write(`Committed contract verified: ${current.toolCount} tools.\n`);
    return;
  }

  throw new Error(`Unknown command: ${command}. Use check, write, or verify.`);
}

await main();
