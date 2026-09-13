#!/usr/bin/env node
/**
 * gh-projects-mcp — stdio entrypoint (Claude Code, Codex CLI/Desktop, and
 * any MCP client that can launch a local subprocess).
 *
 * All tool/domain registration lives in lib/server-factory.mjs so this file
 * and the remote HTTP entrypoint (lib/http-transport.mjs / server-http.mjs,
 * #60) connect the exact same `McpServer` to different transports — no
 * remote-only tool implementation.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './lib/server-factory.mjs';

const server = createMcpServer({ transport: 'stdio' });
const transport = new StdioServerTransport();
await server.connect(transport);
