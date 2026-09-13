/**
 * #64 — static guard against regressing the lazy-load boundary: importing/
 * starting the server must never require Playwright to be resolvable. This
 * complements the behavioural proof in test/browser-ui-isolation.test.mjs and
 * the end-to-end check (server runs with Playwright uninstalled) done for the
 * PR; here we just assert no file outside the browser-ui leaf modules performs
 * a static top-level `import ... from 'playwright'`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Files allowed a static top-level `import ... from 'playwright'` because they
// are themselves ONLY ever reached through a dynamic import() from a
// capability-gated call site (see lib/tools-workflows.mjs, lib/tools-views-graphql.mjs).
const ALLOWED_STATIC_PLAYWRIGHT_IMPORTERS = new Set(['lib/view-groupby-ui.mjs']);

const STATIC_IMPORT_RE = /^\s*import\b[^;]*from\s+['"]playwright['"]/m;

function readSource(relativePath) {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

test('server.mjs never statically imports playwright, view-groupby-ui.mjs, or tools-workflows.mjs\'s browser path eagerly', () => {
  const source = readSource('server.mjs');
  assert.doesNotMatch(source, STATIC_IMPORT_RE);
  assert.doesNotMatch(source, /^\s*import\b[^;]*from\s+['"]\.\/lib\/view-groupby-ui\.mjs['"]/m);
});

test('only the designated leaf module statically imports playwright', () => {
  const candidates = [
    'server.mjs',
    'lib/gql.mjs',
    'lib/github-backend.mjs',
    'lib/helpers.mjs',
    'lib/view-api.mjs',
    'lib/tools-views-graphql.mjs',
    'lib/tools-workflows.mjs',
    'lib/tools-preflight.mjs',
    'lib/runtime-capabilities.mjs',
    'lib/cdp.mjs',
  ];
  for (const relativePath of candidates) {
    const source = readSource(relativePath);
    const staticallyImports = STATIC_IMPORT_RE.test(source);
    assert.equal(
      staticallyImports,
      ALLOWED_STATIC_PLAYWRIGHT_IMPORTERS.has(relativePath),
      `${relativePath} ${staticallyImports ? 'statically imports' : 'does not import'} playwright unexpectedly`,
    );
  }
});

test('tools-workflows.mjs loads playwright only via a dynamic import() call', () => {
  const source = readSource('lib/tools-workflows.mjs');
  assert.match(source, /await import\(['"]playwright['"]\)/);
  assert.doesNotMatch(source, STATIC_IMPORT_RE);
});

test('tools-views-graphql.mjs reaches the browser fallback only via a dynamic import() of view-groupby-ui.mjs, gated by assertBrowserUiAvailable', () => {
  const source = readSource('lib/tools-views-graphql.mjs');
  assert.match(source, /import\(['"]\.\/view-groupby-ui\.mjs['"]\)/);
  assert.match(source, /assertBrowserUiAvailable/);
  // The gate must run before each dynamic import, not after.
  const preflightBlock = source.slice(source.indexOf('defaultGroupByPreflight'), source.indexOf('defaultGroupByApply'));
  assert.ok(preflightBlock.indexOf('assertBrowserUiAvailable') < preflightBlock.indexOf("import('./view-groupby-ui.mjs')"));
});
