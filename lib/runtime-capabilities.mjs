/**
 * Runtime capability / preflight model (#64).
 *
 * Lets `gh-projects-mcp` report — and fail closed on — what it can actually do
 * in the process it is running in (Claude Code desktop, Codex CLI/Desktop,
 * hosted Codex, a future remote HTTP deployment, CI, ...), without requiring
 * Playwright/Edge to be usable just to start the server or run API-backed
 * tools. See docs/CAPABILITIES.md for the expected matrix per runtime.
 *
 * Two layers, both pure/side-effect-light so they stay easy to unit test:
 *
 *   - "static" detection (`detectBrowserUiConfig`, `detectBackendConfig`) reads
 *     only env vars + the already-selected backend's `.kind`/`.capabilities()`.
 *     No network I/O, no Playwright import. This is what `assertBrowserUiAvailable`
 *     uses to fail fast — browser-ui tool entry points call it BEFORE importing
 *     Playwright (directly, or transitively via lib/view-groupby-ui.mjs), so an
 *     unsupported runtime never pays for or attempts to load the browser stack.
 *   - an optional "live" probe (`detectRuntimeCapabilities({ live: true })`)
 *     attempts one REST call, one GraphQL call, and — only on win32 — one local
 *     CDP round trip, to turn "unknown" into a confident "ready"/"unavailable".
 *     Never used implicitly; only when a caller explicitly asks for it.
 *
 * Never returns a secret value: `redactSecrets` scrubs any configured token out
 * of live-probe error text before it lands in a report.
 */
import process from 'node:process';
import { httpGet, CDP_PORT } from './cdp.mjs';

export const READY = 'ready';
export const UNAVAILABLE = 'unavailable';
export const UNKNOWN = 'unknown';

function flagSet(env, name) {
  const value = env[name];
  return value === '1' || value === 'true';
}

/** Replace every occurrence of any given secret string with a fixed placeholder. */
export function redactSecrets(text, secrets = []) {
  let out = String(text ?? '');
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join('***REDACTED***');
  }
  return out;
}

function combineStatus(a, b) {
  if (a === UNAVAILABLE || b === UNAVAILABLE) return UNAVAILABLE;
  if (a === READY && b === READY) return READY;
  return UNKNOWN;
}

/**
 * Static (no I/O) browser-ui capability. The Edge/CDP fallback (lib/cdp.mjs,
 * lib/view-groupby-ui.mjs, the browser path in lib/tools-workflows.mjs) is a
 * Windows-desktop capability by construction (it attaches to a locally running,
 * already-logged-in Edge), so any non-win32 runtime — every container/hosted
 * environment this issue targets — is unavailable without ever touching Edge/CDP.
 */
export function detectBrowserUiConfig({ env = process.env, platform = process.platform } = {}) {
  if (flagSet(env, 'GH_PROJECTS_DISABLE_BROWSER_UI')) {
    return { status: UNAVAILABLE, reason: 'disabled via GH_PROJECTS_DISABLE_BROWSER_UI' };
  }
  if (platform !== 'win32') {
    return {
      status: UNAVAILABLE,
      reason: `the browser-ui fallback (Edge/CDP) is a Windows-desktop capability; unsupported on platform "${platform}"`,
    };
  }
  return {
    status: UNKNOWN,
    reason: 'win32 detected; local Edge/CDP reachability is not probed until a browser-ui tool runs '
      + '(pass live:true to gh_preflight to probe now without running a real browser-ui tool)',
  };
}

/**
 * Fail-closed guard: throws a `capability_unavailable:` error when the
 * browser-ui capability is statically unavailable. Call this BEFORE importing
 * Playwright (directly or via `import('./view-groupby-ui.mjs')`) from any
 * browser-ui tool entry point, so an unsupported runtime never loads it.
 */
export function assertBrowserUiAvailable(options) {
  const { status, reason } = detectBrowserUiConfig(options);
  if (status === UNAVAILABLE) {
    throw new Error(`capability_unavailable: browser-ui — ${reason}`);
  }
}

/**
 * One short-lived live probe of the local CDP endpoint. Uses lib/cdp.mjs's
 * plain `http.get` helper — never imports Playwright — so it is safe to call
 * from capability detection without pulling in the browser stack.
 */
export async function probeBrowserUiLive({ port = CDP_PORT, get = httpGet } = {}) {
  try {
    const response = await get(`http://127.0.0.1:${port}/json/version`);
    return response.status === 200
      ? { status: READY, reason: 'local Edge/CDP endpoint reachable' }
      : { status: UNAVAILABLE, reason: `CDP endpoint responded with HTTP ${response.status}` };
  } catch (error) {
    return { status: UNAVAILABLE, reason: `no local Edge/CDP endpoint reachable: ${error.message}` };
  }
}

/**
 * Static (no I/O) REST/GraphQL/Projects-read/Projects-write/issue-PR readiness
 * derived from the already-selected backend (see lib/github-backend.mjs). Both
 * dimensions currently move together per backend: the github-api backend is
 * REST+GraphQL over HTTP once a token is configured; the gh-cli backend shells
 * out to the same authenticated `gh` binary for both. Whether that binary/token
 * is actually reachable right now is left "unknown" unless `live` is requested.
 */
export function detectBackendConfig({ env = process.env, backend } = {}) {
  const kind = backend?.kind ?? 'unknown';
  let caps = {};
  try { caps = backend?.capabilities?.() ?? {}; } catch { /* best-effort only */ }

  if (kind === 'github-api') {
    const hasToken = Boolean(env.GH_PROJECTS_TOKEN || env.GITHUB_TOKEN);
    const status = hasToken ? READY : UNAVAILABLE;
    return {
      backend: kind,
      rest: status,
      graphql: status,
      projectsRead: status,
      projectsWrite: status,
      issuePr: status,
      details: {
        directApi: caps.directApi ?? true,
        requiresGhCli: caps.requiresGhCli ?? false,
        note: hasToken
          ? 'GH_PROJECTS_TOKEN/GITHUB_TOKEN configured; not live-probed unless live:true'
          : 'no GH_PROJECTS_TOKEN/GITHUB_TOKEN configured',
      },
    };
  }

  if (kind === 'gh-cli') {
    return {
      backend: kind,
      rest: UNKNOWN,
      graphql: UNKNOWN,
      projectsRead: UNKNOWN,
      projectsWrite: UNKNOWN,
      issuePr: UNKNOWN,
      details: {
        directApi: caps.directApi ?? false,
        requiresGhCli: caps.requiresGhCli ?? true,
        note: 'requires a local, authenticated gh CLI with the project scope; not probed unless live:true',
      },
    };
  }

  return {
    backend: kind,
    rest: UNKNOWN,
    graphql: UNKNOWN,
    projectsRead: UNKNOWN,
    projectsWrite: UNKNOWN,
    issuePr: UNKNOWN,
    details: { note: `unrecognized backend kind "${kind}"` },
  };
}

/**
 * Full capability/preflight report, shaped like the example in #64:
 *   { transport, backend, rest, graphql, projectsRead, projectsWrite, issuePr, browserUi }
 * plus a `details` object carrying non-secret diagnostics.
 *
 * `gh`/`gql` are the same injectable functions server.mjs already uses
 * (lib/gql.mjs). When `live` is true and they are provided, one REST call
 * (`gh('api','user')`) and one GraphQL call (`gql('query{viewer{login}}')`)
 * are attempted; their outcome overrides the static rest/graphql/projectsRead/
 * projectsWrite/issuePr fields. Any error text is redacted against the
 * configured token before it is included in the report.
 */
export async function detectRuntimeCapabilities({
  env = process.env,
  platform = process.platform,
  transport = 'stdio',
  backend,
  gh,
  gql,
  live = false,
} = {}) {
  const secrets = [env.GH_PROJECTS_TOKEN, env.GITHUB_TOKEN].filter(Boolean);
  const backendConfig = detectBackendConfig({ env, backend });
  const browserConfig = detectBrowserUiConfig({ env, platform });

  const report = {
    transport,
    backend: backendConfig.backend,
    rest: backendConfig.rest,
    graphql: backendConfig.graphql,
    projectsRead: backendConfig.projectsRead,
    projectsWrite: backendConfig.projectsWrite,
    issuePr: backendConfig.issuePr,
    browserUi: browserConfig.status,
    details: {
      backend: backendConfig.details,
      browserUi: { reason: browserConfig.reason },
      live,
    },
  };

  if (live) {
    if (typeof gh === 'function') {
      try {
        gh('api', 'user');
        report.rest = READY;
      } catch (error) {
        report.rest = UNAVAILABLE;
        report.details.rest = { error: redactSecrets(error?.message ?? String(error), secrets) };
      }
    }
    if (typeof gql === 'function') {
      try {
        gql('query { viewer { login } }');
        report.graphql = READY;
      } catch (error) {
        report.graphql = UNAVAILABLE;
        report.details.graphql = { error: redactSecrets(error?.message ?? String(error), secrets) };
      }
    }
    if (typeof gh === 'function' || typeof gql === 'function') {
      report.issuePr = combineStatus(report.rest, report.graphql);
      report.projectsRead = report.graphql;
      report.projectsWrite = report.graphql;
    }

    if (browserConfig.status === UNKNOWN) {
      const liveBrowser = await probeBrowserUiLive();
      report.browserUi = liveBrowser.status;
      report.details.browserUi = { reason: liveBrowser.reason };
    }
  }

  return report;
}
