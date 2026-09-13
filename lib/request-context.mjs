/**
 * Per-request backend scoping (#60).
 *
 * The stdio transport has exactly one process per client, so a single
 * module-level backend (selected once at startup from env — see
 * lib/gql.mjs / lib/github-backend.mjs) has always been the right model:
 * one identity for the life of the process.
 *
 * A shared remote HTTP deployment is different: many concurrent callers,
 * potentially each with their own GitHub credential, share one Node
 * process. `lib/http-transport.mjs` builds a fresh `GitHubApiBackend` from
 * each request's `Authorization: Bearer <token>` header and needs every
 * tool handler's call to `gh()`/`gql()` (imported from lib/gql.mjs, and
 * used by ~45 handlers across server.mjs and lib/tools-*.mjs) to reach
 * *that* request's backend — without threading a `backend` parameter
 * through every one of those handlers.
 *
 * `AsyncLocalStorage` solves exactly this: `withRequestBackend` runs a
 * callback with a backend bound to that callback's async execution
 * context (and everything it awaits/calls, transitively), so concurrent
 * requests on the same process never observe each other's backend even
 * though `lib/gql.mjs`'s `gh()`/`gql()` are plain module-level functions.
 * When no request-scoped backend is active (the stdio path, or any code
 * running outside `withRequestBackend`), `getRequestBackend()` returns
 * `undefined` and callers fall back to the process-wide backend exactly
 * as before this module existed.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

/**
 * Run `fn` with `backend` as the active request-scoped GitHub backend for
 * the duration of `fn` (including anything it awaits). Returns whatever
 * `fn` returns/resolves to.
 *
 * @template T
 * @param {{ kind: string, gh: Function, gql: Function, capabilities: Function }} backend
 * @param {() => T} fn
 * @returns {T}
 */
export function withRequestBackend(backend, fn) {
  return storage.run(backend, fn);
}

/**
 * The backend bound by the innermost enclosing `withRequestBackend`, or
 * `undefined` if none is active (e.g. the stdio transport, or a live probe
 * running outside any HTTP request).
 */
export function getRequestBackend() {
  return storage.getStore();
}
