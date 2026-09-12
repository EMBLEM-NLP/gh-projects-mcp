/**
 * Shared GitHub backend compatibility utilities.
 *
 * Existing tool code still imports `gh()` / `gql()` from this module. Those
 * functions now delegate to a selected backend so the MCP can keep its public
 * tool contracts while the implementation migrates away from a mandatory local
 * `gh` binary.
 */

import { createBackend } from './github-backend.mjs';

let backend = createBackend();

/** Return the currently selected backend's capability summary. */
export function backendCapabilities() {
  return backend.capabilities();
}

/** Test hook for dependency injection without mutating process.env. */
export function setBackendForTests(nextBackend) {
  backend = nextBackend;
}

/** Restore environment-based backend selection after a test. */
export function resetBackendForTests() {
  backend = createBackend();
}

/**
 * Run one GraphQL query through the selected backend.
 * @param {string} query
 * @param {...string} extra gh-compatible -f/-F variable arguments
 * @returns {object}
 */
export function gql(query, ...extra) {
  return backend.gql(query, ...extra);
}

/**
 * Paginate a GraphQL query that uses cursor-based pagination.
 *
 * @param {(afterClause: string) => string} makeQuery
 * @param {(data: object) => { nodes: any[], pageInfo: { hasNextPage: boolean, endCursor: string } }} getPage
 * @returns {any[]} All nodes across all pages.
 */
export function gqlAll(makeQuery, getPage) {
  const items = [];
  let cursor = null;
  let hasNext = true;
  while (hasNext) {
    const afterClause = cursor ? `, after: "${cursor}"` : '';
    const result = gql(makeQuery(afterClause));
    const page = getPage(result.data);
    items.push(...(page.nodes ?? []));
    hasNext = page.pageInfo?.hasNextPage ?? false;
    cursor = page.pageInfo?.endCursor ?? null;
  }
  return items;
}

/**
 * Run a gh-compatible operation through the selected backend.
 * GhCliBackend supports the complete existing CLI surface; GitHubApiBackend
 * implements API-backed commands incrementally and fails closed for unsupported
 * high-level gh commands.
 */
export function gh(...args) {
  return backend.gh(...args);
}
