#!/usr/bin/env node
/**
 * gh-projects-mcp — remote HTTP MCP transport entrypoint (#60).
 *
 * For hosted Codex / ChatGPT custom apps / other remote MCP clients that
 * cannot launch a local stdio subprocess. See docs/DEPLOYMENT.md for the
 * deployment model and docs/BACKENDS.md for the per-request bearer-token
 * design this entrypoint requires by default.
 *
 * Never binds to a non-loopback host on its own — set GH_PROJECTS_HTTP_HOST
 * only once this process sits behind a reverse proxy/load balancer that
 * terminates TLS, per docs/DEPLOYMENT.md.
 */
import process from 'node:process';
import { startHttpServer, DEFAULT_HTTP_PATH } from './lib/http-transport.mjs';

const httpServer = await startHttpServer();
const address = httpServer.address();
const path = process.env.GH_PROJECTS_HTTP_PATH || DEFAULT_HTTP_PATH;
const host = typeof address === 'object' && address ? address.address : 'unknown';
const port = typeof address === 'object' && address ? address.port : 'unknown';

process.stderr.write(
  `gh-projects-mcp HTTP transport listening on http://${host}:${port}${path} `
  + `(health check: http://${host}:${port}/healthz)\n`,
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    httpServer.close(() => process.exit(0));
  });
}
