/**
 * GitHub Projects v2 view management via Playwright + CDP-attach to an
 * existing, already-logged-in Edge profile.
 *
 * Why Playwright at all: GitHub's public GraphQL API does not expose a
 * createProjectV2View mutation (confirmed via `gh api graphql` — no such
 * field exists), and view *layout* (table/board/roadmap) cannot be set any
 * other way. This drives the web UI directly instead of faking an API call
 * that doesn't exist.
 */
import { z } from 'zod';
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { CDP_PORT, launchEdgeWithCDP, delay } from './cdp.mjs';
import { assertConfirmed, viewNamesFromTabTexts } from './helpers.mjs';

function text(t) {
  return { content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] };
}
function errorText(err) {
  return { isError: true, content: [{ type: 'text', text: err.message ?? String(err) }] };
}

// ── Centralized selectors (audit §6: one place, semantic first) ──────────────
// Prefer page.getByRole/getByText/getByLabel in the functions below. The raw
// string selectors that remain live here. FRAGILE entries depend on GitHub's
// generated CSS-module class names and MUST be covered by the drift canary
// before being trusted — see the "GitHub UI hardening" epic.
const SEL = {
  tabsReady: '[role="tab"]',                                    // presence of the view-tab strip
  tabSelected: '[role="tab"].selected',                        // Primer state class on the open tab
  cancelButtons: 'dialog button:has-text("Cancel"), [role="dialog"] button:has-text("Cancel")',
  primerPortalAnyBtn: '#__primerPortalRoot__ button',          // Primer portal root: stable app id
  primerPortalSaveBtn: '#__primerPortalRoot__ button:has-text("Save")',
  // FRAGILE (generated-class substring) — replace with a role/aria locator under the canary:
  viewOptionsFragile: '[class*="viewOptionsPlaceholder"]',
};

// Resolve user vs organization for the GraphQL root (mirrors server.mjs ownerRoot).
function ownerRoot(owner) {
  try {
    const r = spawnSync('gh', ['api', `users/${owner}`, '--jq', '.type'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim() === 'Organization') return 'organization';
  } catch { /* fall through */ }
  return 'user';
}

async function getOrOpenProjectPage(browser, projectUrl) {
  let page;
  outer: for (const ctx of browser.contexts()) {
    for (const pg of ctx.pages()) {
      if (pg.url().includes('github.com')) { page = pg; break outer; }
    }
  }
  if (!page) {
    const ctx = browser.contexts()[0] ?? await browser.newContext();
    page = await ctx.newPage();
  }
  await page.goto(projectUrl, { waitUntil: 'load', timeout: 60_000 });
  try { await page.keyboard.press('Escape'); await delay(300); } catch { /* ignore */ }
  await page.waitForSelector(SEL.tabsReady, { timeout: 30_000 });
  return page;
}

async function getExistingViewNames(page) {
  const tabTexts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="tab"]')).map(el => el.textContent)
  );
  // Normalizing/filtering is the pure, unit-tested viewNamesFromTabTexts helper.
  return viewNamesFromTabTexts(tabTexts);
}

async function dismissAllDialogs(page) {
  try {
    const cancelBtn = page.locator(SEL.cancelButtons).first();
    if (await cancelBtn.isVisible({ timeout: 1000 })) {
      await cancelBtn.click();
      await page.waitForTimeout(400);
      return;
    }
  } catch { /* none */ }
  try { await page.keyboard.press('Escape'); await page.waitForTimeout(300); } catch { /* ignore */ }
}

async function dismissWelcomeDialogs(page) {
  const buttons = [
    () => page.getByRole('button', { name: /got it/i }),
    () => page.getByRole('button', { name: /dismiss/i }),
    () => page.locator('button:has-text("Got it")'),
  ];
  for (const sel of buttons) {
    try {
      const btn = sel();
      if (await btn.isVisible({ timeout: 1000 })) { await btn.click(); await page.waitForTimeout(300); }
    } catch { /* no dialog */ }
  }
}

async function saveUnsavedChanges(page) {
  let hasPendingSave = false;
  try {
    hasPendingSave = await page.locator('button:has-text("Discard")').first().isVisible({ timeout: 2000 });
  } catch { /* none */ }
  if (!hasPendingSave) return;

  try {
    await page.getByRole('button', { name: 'Save' }).first().click();
    await page.waitForTimeout(800);
  } catch { /* unexpected */ }

  try {
    await page.waitForSelector(SEL.primerPortalAnyBtn, { timeout: 3000 });
    const confirmBtn = page.locator(SEL.primerPortalSaveBtn).first();
    if (await confirmBtn.isVisible({ timeout: 2000 })) {
      await confirmBtn.click();
      await page.waitForTimeout(600);
    }
  } catch { /* no secondary confirm */ }
}

async function deleteViewByName(page, viewName) {
  // Match on the tab's own trimmed text (equivalent to getExistingViewNames) —
  // no generated-class dependency.
  const viewUrl = await page.evaluate((name) => {
    const tab = Array.from(document.querySelectorAll('[role="tab"]'))
      .find(t => t.textContent.replace(/^\+\s*/, '').trim() === name);
    return tab?.href ?? null;
  }, viewName);

  if (!viewUrl) return false;

  await page.goto(viewUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector(SEL.tabSelected, { timeout: 15_000 });
  await page.waitForTimeout(500);
  await dismissWelcomeDialogs(page);

  const placeholder = page.locator(SEL.viewOptionsFragile).first();
  const box = await placeholder.boundingBox().catch(() => null);
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(600);

  const deleteItem = page.locator('[role="menuitem"]:has-text("Delete view")');
  if (!await deleteItem.isVisible({ timeout: 3000 })) {
    await page.keyboard.press('Escape');
    return false;
  }
  await deleteItem.click();
  await page.waitForTimeout(800);

  const confirmBtn = page.getByRole('button', { name: /^delete$/i })
    .or(page.locator('dialog button:has-text("Delete"), [role="dialog"] button:has-text("Delete")'));
  if (await confirmBtn.isVisible({ timeout: 3000 })) {
    await confirmBtn.click();
    await page.waitForTimeout(1200);
  }
  return true;
}

async function clickNewViewButton(page) {
  const strategies = [
    () => page.getByRole('button', { name: /new view/i }),
    () => page.locator('button:has-text("New view")').first(),
    () => page.locator(':text("New view")').first(),
    () => page.getByRole('tab', { name: /new view/i }),
  ];
  for (const strategy of strategies) {
    try {
      const el = strategy();
      if (await el.isVisible({ timeout: 2000 })) { await el.click(); await page.waitForTimeout(800); return; }
    } catch { /* try next */ }
  }
  throw new Error('Could not find "New view" tab.');
}

async function setViewLayout(page, layout) {
  const layoutSelectors = {
    table: [/^table$/i],
    board: [/board/i, /kanban/i],
    roadmap: [/roadmap/i, /timeline/i],
  };
  const patterns = layoutSelectors[layout] ?? [];
  for (const pattern of patterns) {
    try {
      const btn = page.getByRole('menuitem', { name: pattern });
      if (await btn.isVisible({ timeout: 2000 })) { await btn.click(); await page.waitForTimeout(400); return; }
    } catch { /* next */ }
  }
  for (const pattern of patterns) {
    try {
      const btn = page.getByRole('button', { name: pattern });
      if (await btn.isVisible({ timeout: 2000 })) { await btn.click(); await page.waitForTimeout(400); return; }
    } catch { /* next */ }
  }
}

async function setViewName(page, name) {
  try {
    const activeTab = page.locator('[role="tab"][aria-selected="true"]');
    await activeTab.dblclick({ timeout: 3000 });
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+a');
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    return;
  } catch { /* try alternative */ }
  try {
    const input = page.locator('input[type="text"]:visible').first();
    if (await input.isVisible({ timeout: 2000 })) {
      await input.fill(name);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
    }
  } catch { /* give up quietly — caller can verify via gh_project_views_list */ }
}

async function setGroupBy(page, fieldName) {
  if (!fieldName) return;
  const selectors = [
    () => page.getByRole('button', { name: /group\s*by/i }),
    () => page.locator('button[aria-label*="group by" i]'),
    () => page.locator('button:has-text("Group by")'),
  ];
  let opened = false;
  for (const sel of selectors) {
    try {
      const btn = sel();
      if (await btn.isVisible({ timeout: 2000 })) { await btn.click(); await page.waitForTimeout(400); opened = true; break; }
    } catch { /* next */ }
  }
  if (!opened) return;

  try {
    const item = page.getByRole('option', { name: new RegExp(fieldName, 'i') })
      .or(page.getByRole('menuitem', { name: new RegExp(fieldName, 'i') }));
    if (await item.isVisible({ timeout: 2000 })) { await item.click(); await page.waitForTimeout(400); return; }
  } catch { /* try label */ }

  try {
    const label = page.locator(`label:has-text("${fieldName}"), [role="option"]:has-text("${fieldName}")`);
    if (await label.isVisible({ timeout: 2000 })) {
      await label.click(); await page.waitForTimeout(400); await page.keyboard.press('Escape');
    }
  } catch { /* continue */ }
}

async function setFilter(page, filterText) {
  if (!filterText) return;
  try {
    const cancelBtn = page.locator('dialog button:has-text("Cancel"), [role="dialog"] button:has-text("Cancel")').first();
    if (await cancelBtn.isVisible({ timeout: 800 })) await cancelBtn.click();
  } catch { /* none */ }

  const selectors = [
    () => page.getByPlaceholder(/filter/i),
    () => page.locator('input[aria-label*="filter" i]'),
    () => page.locator('input[placeholder*="filter" i]'),
  ];
  for (const sel of selectors) {
    try {
      const input = sel();
      if (await input.isVisible({ timeout: 2000 })) {
        await input.click(); await input.fill(filterText); await page.keyboard.press('Enter'); await page.waitForTimeout(500); return;
      }
    } catch { /* next */ }
  }
}

async function withProjectPage(owner, number, fn) {
  const projectUrl = `https://github.com/users/${owner}/projects/${number}`;
  await launchEdgeWithCDP(projectUrl);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  try {
    const page = await getOrOpenProjectPage(browser, projectUrl);
    const title = await page.title();
    if (title.toLowerCase().includes('sign in') || title.toLowerCase().includes('login')) {
      throw new Error('Not authenticated in Edge. Log into GitHub in the Edge browser window and retry.');
    }
    return await fn(page, projectUrl);
  } finally {
    await browser.close();
  }
}

/**
 * gh_project_view_delete handler, with the Playwright driver injected so the
 * confirm-gate can be unit-tested without launching a browser. On confirm:false
 * it refuses before ever calling withProjectPageFn.
 */
export function makeViewDeleteHandler(withProjectPageFn) {
  return async ({ owner, number, viewName, confirm }) => {
    try {
      assertConfirmed(confirm, 'delete view');
      const deleted = await withProjectPageFn(owner, number, (page) => deleteViewByName(page, viewName));
      return text(deleted ? `Deleted view "${viewName}".` : `Could not find or delete view "${viewName}".`);
    } catch (err) {
      return errorText(err);
    }
  };
}

export function registerViewTools(server) {
  server.tool(
    'gh_project_view_create',
    'Create (or, with reapply=true, re-apply settings to existing) views on a GitHub Project via Playwright driving GitHub\'s web UI in your existing logged-in Edge browser. Required because GitHub\'s GraphQL API has no createProjectV2View mutation and cannot set view layout. By default this only CREATES views and REPORTS (does not delete) ghost tabs and layout-mismatched views — pass pruneGhostViews:true to allow those deletions/recreations.',
    {
      owner: z.string().describe('Project owner login'),
      number: z.number().describe('Project number'),
      views: z.array(z.object({
        name: z.string(),
        layout: z.enum(['table', 'board', 'roadmap']).optional().describe('Default: table'),
        groupBy: z.string().optional().describe('Field name to group board columns by, e.g. "Status" or "Owner"'),
        filter: z.string().optional().describe('GitHub Projects filter syntax, e.g. "status:Backlog" or "-status:Done -status:Backlog"'),
      })).describe('Declarative view spec — existing views with matching names are skipped unless reapply=true'),
      reapply: z.boolean().optional().describe('Re-apply filter/groupBy to views that already exist instead of skipping them'),
      pruneGhostViews: z.boolean().optional().describe('Destructive: DELETE view tabs not in the spec and delete+recreate layout-mismatched views. Default false (only report them under wouldPrune).'),
    },
    async ({ owner, number, views, reapply, pruneGhostViews }) => {
      try {
        const result = await withProjectPage(owner, number, async (page, projectUrl) => {
          const existingNames = await getExistingViewNames(page);
          const wouldPrune = [];

          const expectedNameSet = new Set(['view 1', ...views.map(v => v.name.toLowerCase())]);
          const ghosts = existingNames.filter(n => !expectedNameSet.has(n.toLowerCase()));
          if (pruneGhostViews) {
            for (const ghost of ghosts) {
              await deleteViewByName(page, ghost);
              await page.waitForTimeout(500);
            }
          } else {
            wouldPrune.push(...ghosts.map(g => ({ view: g, reason: 'ghost (not in spec)' })));
          }

          try {
            const root = ownerRoot(owner);
            const layoutQuery = `query { ${root}(login: "${owner}") { projectV2(number: ${number}) { views(first: 20) { nodes { name layout } } } } }`;
            const layoutResult = spawnSync('gh', ['api', 'graphql', '-f', `query=${layoutQuery}`], { encoding: 'utf8' });
            if (layoutResult.status === 0) {
              const ghViews = JSON.parse(layoutResult.stdout).data[root].projectV2.views.nodes;
              const ghLayoutMap = Object.fromEntries(ghViews.map(v => [v.name, v.layout]));
              const specToGh = { table: 'TABLE_LAYOUT', board: 'BOARD_LAYOUT', roadmap: 'ROADMAP_LAYOUT' };
              const mismatches = views.filter(v => {
                const ghLayout = ghLayoutMap[v.name];
                return ghLayout && ghLayout !== specToGh[v.layout ?? 'table'];
              });
              if (pruneGhostViews) {
                for (const v of mismatches) {
                  await deleteViewByName(page, v.name);
                  const idx = existingNames.findIndex(n => n.toLowerCase() === v.name.toLowerCase());
                  if (idx !== -1) existingNames.splice(idx, 1);
                }
                await page.waitForTimeout(800);
              } else {
                wouldPrune.push(...mismatches.map(v => ({ view: v.name, reason: `layout mismatch (want ${v.layout ?? 'table'})` })));
              }
            }
          } catch { /* layout check is best-effort */ }

          let created = 0, skipped = 0, reapplied = 0;
          for (const view of views) {
            const alreadyExists = existingNames.some(n => n.toLowerCase() === view.name.toLowerCase());

            if (alreadyExists && !reapply) { skipped++; continue; }

            if (alreadyExists && reapply) {
              await dismissAllDialogs(page);
              try {
                await page.getByRole('tab', { name: new RegExp(view.name, 'i') }).click();
                await page.waitForTimeout(700);
                await dismissAllDialogs(page);
                await dismissWelcomeDialogs(page);
              } catch { /* continue */ }
              if (view.filter) { await setFilter(page, view.filter); await saveUnsavedChanges(page); }
              reapplied++;
              continue;
            }

            await clickNewViewButton(page);
            await setViewLayout(page, view.layout ?? 'table');
            await setViewName(page, view.name);
            if (view.groupBy) await setGroupBy(page, view.groupBy);
            if (view.filter) { await setFilter(page, view.filter); await saveUnsavedChanges(page); }
            await dismissWelcomeDialogs(page);
            await page.waitForTimeout(2500);
            created++;

            await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            await page.waitForTimeout(3000);
            await dismissWelcomeDialogs(page);
            await page.waitForTimeout(500);
          }

          // Fail closed (audit §10): confirm every spec view actually exists now,
          // instead of silently reporting success if a UI selector drifted mid-run.
          let verified = true; let missing = [];
          try {
            const root = ownerRoot(owner);
            const q = `query { ${root}(login: "${owner}") { projectV2(number: ${number}) { views(first: 50) { nodes { name } } } } }`;
            const vr = spawnSync('gh', ['api', 'graphql', '-f', `query=${q}`], { encoding: 'utf8' });
            if (vr.status === 0) {
              const live = new Set(JSON.parse(vr.stdout).data[root].projectV2.views.nodes.map(n => n.name.toLowerCase()));
              missing = views.filter(v => !live.has(v.name.toLowerCase())).map(v => v.name);
              verified = missing.length === 0;
            }
          } catch { verified = false; }
          if (!verified && missing.length) {
            throw new Error(`View-creation drift: spec views absent after the run (a UI selector may have changed) — ${missing.join(', ')}. created=${created} skipped=${skipped} reapplied=${reapplied}. Run the canary/fixture tests before trusting the fallback.`);
          }
          return { created, skipped, reapplied, verified,
            ghostsDeleted: pruneGhostViews ? ghosts.length : 0,
            wouldPrune: pruneGhostViews ? [] : wouldPrune,
            projectUrl };
        });
        return text(result);
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.tool(
    'gh_project_view_delete',
    'Delete one view (tab) from a GitHub Project via Playwright driving the web UI. Destructive — requires confirm:true.',
    {
      owner: z.string().describe('Project owner login'),
      number: z.number().describe('Project number'),
      viewName: z.string().describe('Exact name of the view to delete'),
      confirm: z.boolean().describe('Must be true to proceed — deleting a view cannot be undone'),
    },
    makeViewDeleteHandler(withProjectPage),
  );
}
