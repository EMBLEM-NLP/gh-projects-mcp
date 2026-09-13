import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  READY,
  UNAVAILABLE,
  UNKNOWN,
  redactSecrets,
  detectBrowserUiConfig,
  assertBrowserUiAvailable,
  probeBrowserUiLive,
  detectBackendConfig,
  detectRuntimeCapabilities,
} from '../lib/runtime-capabilities.mjs';

// ── redactSecrets ────────────────────────────────────────────────────────────

test('redactSecrets scrubs every occurrence of every secret and leaves the rest intact', () => {
  const out = redactSecrets('token ghp_abc123 failed twice: ghp_abc123 again', ['ghp_abc123']);
  assert.equal(out, 'token ***REDACTED*** failed twice: ***REDACTED*** again');
});

test('redactSecrets is a no-op with no secrets and tolerates undefined/null text', () => {
  assert.equal(redactSecrets('plain text', []), 'plain text');
  assert.equal(redactSecrets(undefined), '');
  assert.equal(redactSecrets(null, ['x']), '');
});

// ── detectBrowserUiConfig / assertBrowserUiAvailable ────────────────────────

test('browser-ui is unavailable on any non-win32 platform (the hosted/container case this issue targets)', () => {
  for (const platform of ['linux', 'darwin', 'freebsd']) {
    const result = detectBrowserUiConfig({ env: {}, platform });
    assert.equal(result.status, UNAVAILABLE);
    assert.match(result.reason, new RegExp(platform));
  }
});

test('assertBrowserUiAvailable throws a capability_unavailable error on a non-win32 platform', () => {
  assert.throws(
    () => assertBrowserUiAvailable({ env: {}, platform: 'linux' }),
    /capability_unavailable: browser-ui/,
  );
});

test('browser-ui is unknown (not yet probed) on win32 with no explicit disable', () => {
  const result = detectBrowserUiConfig({ env: {}, platform: 'win32' });
  assert.equal(result.status, UNKNOWN);
  assert.doesNotThrow(() => assertBrowserUiAvailable({ env: {}, platform: 'win32' }));
});

test('GH_PROJECTS_DISABLE_BROWSER_UI forces unavailable even on win32', () => {
  const result = detectBrowserUiConfig({ env: { GH_PROJECTS_DISABLE_BROWSER_UI: '1' }, platform: 'win32' });
  assert.equal(result.status, UNAVAILABLE);
  assert.match(result.reason, /GH_PROJECTS_DISABLE_BROWSER_UI/);
  assert.throws(() => assertBrowserUiAvailable({ env: { GH_PROJECTS_DISABLE_BROWSER_UI: 'true' }, platform: 'win32' }));
});

// ── probeBrowserUiLive ───────────────────────────────────────────────────────

test('probeBrowserUiLive reports ready when the injected getter resolves 200', async () => {
  const result = await probeBrowserUiLive({ get: async () => ({ status: 200, data: '{}' }) });
  assert.equal(result.status, READY);
});

test('probeBrowserUiLive reports unavailable on a non-200 response or a thrown error', async () => {
  const notOk = await probeBrowserUiLive({ get: async () => ({ status: 500, data: '' }) });
  assert.equal(notOk.status, UNAVAILABLE);
  assert.match(notOk.reason, /500/);

  const refused = await probeBrowserUiLive({ get: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(refused.status, UNAVAILABLE);
  assert.match(refused.reason, /ECONNREFUSED/);
});

// ── detectBackendConfig ──────────────────────────────────────────────────────

test('github-api backend is ready across the board once a token is configured', () => {
  const backend = { kind: 'github-api', capabilities: () => ({ directApi: true, requiresGhCli: false }) };
  const result = detectBackendConfig({ env: { GH_PROJECTS_TOKEN: 'secret' }, backend });
  assert.equal(result.rest, READY);
  assert.equal(result.graphql, READY);
  assert.equal(result.projectsRead, READY);
  assert.equal(result.projectsWrite, READY);
  assert.equal(result.issuePr, READY);
});

test('github-api backend is unavailable across the board with no token configured', () => {
  const backend = { kind: 'github-api', capabilities: () => ({}) };
  const result = detectBackendConfig({ env: {}, backend });
  assert.equal(result.rest, UNAVAILABLE);
  assert.equal(result.graphql, UNAVAILABLE);
  assert.equal(result.issuePr, UNAVAILABLE);
});

test('gh-cli backend is unknown until live-probed (gh binary presence cannot be inferred from env alone)', () => {
  const backend = { kind: 'gh-cli', capabilities: () => ({ requiresGhCli: true, directApi: false }) };
  const result = detectBackendConfig({ env: {}, backend });
  assert.equal(result.rest, UNKNOWN);
  assert.equal(result.graphql, UNKNOWN);
  assert.equal(result.issuePr, UNKNOWN);
});

test('an unrecognized/mock backend kind degrades to unknown rather than throwing', () => {
  const result = detectBackendConfig({ env: {}, backend: { kind: 'mock', capabilities: () => ({}) } });
  assert.equal(result.backend, 'mock');
  assert.equal(result.rest, UNKNOWN);
});

test('detectBackendConfig tolerates a backend whose capabilities() throws', () => {
  const backend = { kind: 'github-api', capabilities: () => { throw new Error('boom'); } };
  const result = detectBackendConfig({ env: { GH_PROJECTS_TOKEN: 't' }, backend });
  assert.equal(result.rest, READY);
});

// ── detectRuntimeCapabilities (full report) ─────────────────────────────────

test('static report shape matches the #64 example for a configured github-api backend on a hosted/container runtime', async () => {
  const backend = { kind: 'github-api', capabilities: () => ({ directApi: true, requiresGhCli: false }) };
  const report = await detectRuntimeCapabilities({
    env: { GH_PROJECTS_TOKEN: 'secret' },
    platform: 'linux',
    transport: 'stdio',
    backend,
  });
  assert.deepEqual(report, {
    transport: 'stdio',
    backend: 'github-api',
    rest: READY,
    graphql: READY,
    projectsRead: READY,
    projectsWrite: READY,
    issuePr: READY,
    browserUi: UNAVAILABLE,
    details: {
      backend: {
        directApi: true,
        requiresGhCli: false,
        note: 'GH_PROJECTS_TOKEN/GITHUB_TOKEN configured; not live-probed unless live:true',
      },
      browserUi: { reason: report.details.browserUi.reason },
      live: false,
    },
  });
  assert.match(report.details.browserUi.reason, /linux/);
});

test('never includes the configured token value anywhere in the static report', async () => {
  const token = 'ghp_super_secret_value_12345';
  const backend = { kind: 'github-api', capabilities: () => ({}) };
  const report = await detectRuntimeCapabilities({ env: { GH_PROJECTS_TOKEN: token }, platform: 'linux', backend });
  assert.doesNotMatch(JSON.stringify(report), new RegExp(token));
});

test('live probe redacts the token out of a failed REST/GraphQL error and reports unavailable', async () => {
  const token = 'ghp_live_secret';
  const backend = { kind: 'github-api', capabilities: () => ({}) };
  const gh = () => { throw new Error(`GitHub API 401 Unauthorized: bad credentials for ${token}`); };
  const gql = () => { throw new Error(`GraphQL errors: token ${token} rejected`); };
  const report = await detectRuntimeCapabilities({
    env: { GH_PROJECTS_TOKEN: token }, platform: 'linux', backend, gh, gql, live: true,
  });
  assert.equal(report.rest, UNAVAILABLE);
  assert.equal(report.graphql, UNAVAILABLE);
  assert.equal(report.issuePr, UNAVAILABLE);
  assert.equal(report.projectsRead, UNAVAILABLE);
  assert.doesNotMatch(JSON.stringify(report), new RegExp(token));
  assert.match(report.details.rest.error, /REDACTED/);
  assert.match(report.details.graphql.error, /REDACTED/);
});

test('live probe reports ready when the injected gh/gql calls succeed', async () => {
  const backend = { kind: 'github-api', capabilities: () => ({}) };
  const gh = () => ({ stdout: '{}' });
  const gql = () => ({ data: { viewer: { login: 'octocat' } } });
  const report = await detectRuntimeCapabilities({
    env: { GH_PROJECTS_TOKEN: 't' }, platform: 'linux', backend, gh, gql, live: true,
  });
  assert.equal(report.rest, READY);
  assert.equal(report.graphql, READY);
  assert.equal(report.projectsWrite, READY);
  assert.equal(report.issuePr, READY);
});

test('live probe on win32 falls through to a CDP probe when browser-ui was otherwise unknown', async () => {
  // detectRuntimeCapabilities calls the real probeBrowserUiLive (httpGet); force
  // it unreachable by pointing at a closed port rather than mocking the module.
  const backend = { kind: 'gh-cli', capabilities: () => ({}) };
  const report = await detectRuntimeCapabilities({
    env: {}, platform: 'win32', backend, live: true,
  });
  assert.equal(report.browserUi, UNAVAILABLE);
  assert.ok(report.details.browserUi.reason.length > 0);
});

test('non-live report never touches gh/gql even when provided', async () => {
  let called = false;
  const gh = () => { called = true; };
  const gql = () => { called = true; };
  await detectRuntimeCapabilities({ env: {}, platform: 'linux', backend: { kind: 'gh-cli' }, gh, gql, live: false });
  assert.equal(called, false);
});
