/**
 * gh_preflight — the #64 runtime capability/preflight tool.
 *
 * Reports transport/backend/REST/GraphQL/Projects-read/Projects-write/
 * issue-PR/browser-ui readiness as structured JSON, so a caller (human or
 * agent) can tell up front which tool families will work in this process —
 * without ever including a token value in the response.
 */
import { z } from 'zod';
import { gh as realGh, gql as realGql, backendCapabilities } from './gql.mjs';
import { detectRuntimeCapabilities } from './runtime-capabilities.mjs';

function text(value) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

function errorText(error) {
  return { isError: true, content: [{ type: 'text', text: error?.message ?? String(error) }] };
}

/** Handler factory so capability detection is testable without a live GitHub backend. */
export function makePreflightHandler({ gh, gql, getBackend, transport = 'stdio' } = {}) {
  return async ({ live } = {}) => {
    try {
      const backend = getBackend ? getBackend() : {};
      const report = await detectRuntimeCapabilities({ transport, backend, gh, gql, live: Boolean(live) });
      return text(report);
    } catch (error) {
      return errorText(error);
    }
  };
}

export function registerPreflightTool(server, deps = {}) {
  const gh = deps.gh ?? realGh;
  const gql = deps.gql ?? realGql;
  // backendCapabilities() (lib/gql.mjs) returns the selected backend's own
  // capabilities() summary, whose `backend` field is exactly the `.kind` the
  // detector wants — reshape it into the {kind, capabilities()} the detector
  // expects rather than importing github-backend.mjs a second time.
  const getBackend = deps.getBackend ?? (() => {
    const caps = backendCapabilities();
    return { kind: caps.backend, capabilities: () => caps };
  });

  server.tool(
    'gh_preflight',
    'Report this server\'s runtime capability matrix as structured JSON: transport, selected backend, '
      + 'and rest/graphql/projectsRead/projectsWrite/issuePr/browserUi readiness (ready/unavailable/unknown). '
      + 'Never includes token values. Default is configuration-only detection; pass live:true to also attempt '
      + 'one REST call, one GraphQL call, and (on win32 only) a local Edge/CDP reachability probe.',
    {
      live: z.boolean().optional().describe(
        'Attempt a live REST/GraphQL round trip (and, on win32, a local CDP probe) instead of '
        + 'configuration-only detection. Default false.',
      ),
    },
    makePreflightHandler({ gh, gql, getBackend }),
  );
}
