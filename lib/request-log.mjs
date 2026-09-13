/**
 * Request/auth logging (#60).
 *
 * The stdio path has never logged anything (nothing in server.mjs / lib/
 * wrote to stderr before this), because a local subprocess's audit trail is
 * its client's own responsibility. A shared remote HTTP deployment is
 * different: several requests, several possible callers, one process — the
 * issue asks for request/auth logging there. Rather than invent an
 * HTTP-only logging shape, this module is the one place any transport would
 * call into, so a future stdio caller that wants structured logs reuses it
 * instead of a second approach.
 *
 * Hard rule: never pass a secret (bearer token, GH_PROJECTS_TOKEN value) or
 * project/issue body content into `logEvent`. Only pass identifiers/shape —
 * method, path, status, tool name, elapsed time, an error *message* (already
 * redacted by lib/runtime-capabilities.mjs's `redactSecrets` where it might
 * contain a token) — never `body`/`params`/`arguments` wholesale.
 */
import process from 'node:process';

/**
 * Emit one structured log line to `write` (default `process.stderr.write`,
 * matching every other diagnostic this server has ever produced — stdout is
 * reserved for the stdio JSON-RPC stream and must never carry log lines).
 *
 * @param {object} fields Plain, non-secret, non-body fields to log. Always
 *   stamped with an ISO `time`. Typical fields: `event`, `requestId`,
 *   `transport`, `method`, `path`, `status`, `durationMs`, `tool`, `reason`.
 * @param {{ write?: (line: string) => void }} [options]
 */
export function logEvent(fields, { write } = {}) {
  const emit = write ?? ((line) => process.stderr.write(line));
  const line = JSON.stringify({ time: new Date().toISOString(), ...fields });
  emit(`${line}\n`);
}
