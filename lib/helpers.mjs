/**
 * Pure, dependency-injectable helpers shared across the server and extracted so
 * they can be unit-tested without a live GitHub / gh CLI.
 *
 * Nothing here spawns a process directly: functions that need `gh` take it as an
 * argument, so tests can pass a stub. Keeping these pieces pure is what makes the
 * confirm-gate and owner-resolution behaviour testable offline.
 */

/** Escape a string for safe inline insertion into a GraphQL query literal. */
export function gqlStr(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Build an `ownerRoot(owner)` resolver bound to an injectable `gh`.
 *
 * Resolves whether an owner is a user or an organization so GraphQL queries pick
 * the correct root field. GitHub's /users/{login} endpoint answers for both and
 * returns type "User" | "Organization". Result is cached per resolver instance;
 * any lookup failure falls back to "user".
 *
 * @param {(...args: string[]) => { stdout: string }} gh
 * @returns {(owner: string) => 'user' | 'organization'}
 */
export function makeOwnerRoot(gh) {
  const cache = new Map();
  return function ownerRoot(owner) {
    if (cache.has(owner)) return cache.get(owner);
    let root = 'user';
    try {
      const r = gh('api', `users/${owner}`, '--jq', '.type');
      if (r.stdout.trim() === 'Organization') root = 'organization';
    } catch { /* default to user on any lookup failure */ }
    cache.set(owner, root);
    return root;
  };
}

/**
 * Confirm-gate guard for destructive operations. Throws (with an actionable
 * message) unless `confirm === true`, so callers refuse before touching gh.
 *
 * @param {unknown} confirm  The caller-supplied confirm flag.
 * @param {string} action    Human phrase for the message, e.g. "merge PR".
 */
export function assertConfirmed(confirm, action) {
  if (confirm !== true) {
    throw new Error(`Refusing to ${action} without confirm:true.`);
  }
}

/**
 * Guard against the updateProjectV2Field option-replacement footgun: the mutation
 * replaces the whole option set, so any current option missing from the desired
 * list would be deleted (with its item assignments). Returns the list of options
 * that would be removed; throws unless `allowRemove` is true and something drops.
 *
 * Pure: takes already-fetched name arrays, does no I/O.
 *
 * @param {string[]} currentNames  Existing option names.
 * @param {string[]} desiredNames  Names in the caller's desired option set.
 * @param {boolean} [allowRemove]  Permit dropping options.
 * @returns {string[]} The removed option names (empty when nothing drops).
 */
export function guardOptionRemoval(currentNames, desiredNames, allowRemove) {
  const removed = currentNames.filter((n) => !desiredNames.includes(n));
  if (removed.length && !allowRemove) {
    throw new Error(`This would DELETE options not in your list: ${removed.join(', ')}. Include them, or pass allowRemove:true to confirm deletion.`);
  }
  return removed;
}

/**
 * Normalize a project view tab's raw text: strip the leading "+" of the
 * "New view" affordance and trim. Mirrors the DOM parsing in tools-views.mjs.
 */
export function normalizeTabText(raw) {
  return String(raw).replace(/^\+\s*/, '').trim();
}

/**
 * Turn a list of raw tab texts into the real view names — normalized, with empty
 * entries and the "New view" placeholder dropped. Pure extraction of the DOM
 * filtering in getExistingViewNames().
 */
export function viewNamesFromTabTexts(tabTexts) {
  return tabTexts
    .map(normalizeTabText)
    .filter((t) => t && t.toLowerCase() !== 'new view');
}
