import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = (path) => JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8'));
const expected = json('contracts/tools.json');

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

function expectedProtocolTools() {
  return expected.tools
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: normalize(tool.inputSchema),
      ...(tool.outputSchema ? { outputSchema: normalize(tool.outputSchema) } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function actualProtocolTools(tools) {
  return tools
    .map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: normalize(tool.inputSchema ?? {}),
      ...(tool.outputSchema ? { outputSchema: normalize(tool.outputSchema) } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function listFromConfig(label, config) {
  const cwd = config.cwd ? resolve(repoRoot, config.cwd) : repoRoot;
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args ?? [],
    cwd,
    env: cleanEnv({
      GH_PROJECTS_BACKEND: 'api',
      GH_PROJECTS_TOKEN: 'client-package-contract-placeholder',
    }),
    stderr: 'pipe',
  });
  const client = new Client({ name: `gh-projects-${label}-contract`, version: '1.0.0' });
  try {
    await client.connect(transport);
    const response = await client.listTools();
    return actualProtocolTools(response.tools);
  } finally {
    await client.close();
  }
}

async function main() {
  const codexMcp = json('.mcp.json').mcpServers?.['gh-projects'];
  if (!codexMcp) throw new Error('Codex .mcp.json does not declare gh-projects.');

  const claudeMcp = json('.claude-plugin/plugin.json').mcpServers?.['gh-projects'];
  if (!claudeMcp) throw new Error('Claude plugin manifest does not declare gh-projects.');

  const contract = expectedProtocolTools();
  const codexTools = await listFromConfig('codex', codexMcp);
  const claudeTools = await listFromConfig('claude', claudeMcp);

  const expectedJson = JSON.stringify(contract);
  if (JSON.stringify(codexTools) !== expectedJson) {
    throw new Error('Codex plugin tools/list differs from contracts/tools.json.');
  }
  if (JSON.stringify(claudeTools) !== expectedJson) {
    throw new Error('Claude plugin tools/list differs from contracts/tools.json.');
  }
  if (JSON.stringify(codexTools) !== JSON.stringify(claudeTools)) {
    throw new Error('Claude and Codex package tool contracts differ.');
  }

  process.stdout.write(`Client package parity OK: Claude and Codex both expose ${contract.length} tools.\n`);
}

await main();
