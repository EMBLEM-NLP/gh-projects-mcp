/**
 * Shared Edge/CDP helpers for Playwright-driven GitHub automation.
 * GitHub Projects v2's GraphQL API does not expose view creation/layout
 * mutations, so view management drives the web UI directly via an
 * existing, already-logged-in Edge profile (CDP attach, not a fresh
 * headless browser).
 */
import { existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

export const CDP_PORT = 9222;
export const EDGE_USER_DATA = path.join(
  os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data'
);

export function getEdgePath() {
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  for (const p of candidates) { if (existsSync(p)) return p; }
  return 'msedge.exe';
}

export function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

export async function waitForCDP(maxWait = 30_000, port = CDP_PORT) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const resp = await httpGet(`http://127.0.0.1:${port}/json/version`);
      if (resp.status === 200) return JSON.parse(resp.data);
    } catch { /* not ready */ }
    await delay(1000);
  }
  throw new Error(`CDP endpoint not ready on port ${port} after ${maxWait / 1000}s`);
}

/**
 * Attach-only: connect to an Edge that is ALREADY running with remote debugging.
 * This never closes or relaunches the user's browser. If no CDP endpoint is
 * listening, it throws with instructions instead of force-killing every Edge
 * window (the previous behavior — a destructive surprise for a project tool).
 */
export async function launchEdgeWithCDP(_initialUrl, { port = CDP_PORT } = {}) {
  try {
    await waitForCDP(3000, port);
    return; // an Edge with remote debugging is already listening — attach to it
  } catch {
    throw new Error(
      `No Edge DevTools endpoint on 127.0.0.1:${port}. This tool ATTACHES to an existing, ` +
      `already-logged-in Edge and will not close your browser. Fully quit Edge, then relaunch ` +
      `it with remote debugging and sign in to github.com:\n` +
      `  msedge.exe --remote-debugging-port=${port} --user-data-dir="${EDGE_USER_DATA}"\n` +
      `then retry.`,
    );
  }
}

export async function screenshot(page, name, dir) {
  mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${name}.png`);
  await page.screenshot({ path: p, fullPage: false, timeout: 10_000, animations: 'disabled' })
    .catch(() => { /* best-effort debug artifact */ });
  return p;
}

export function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}
