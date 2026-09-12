/**
 * GitHub Projects v2 workflow automation (auto-add, auto-close, etc.) via
 * Playwright + CDP-attach to an existing, already-logged-in Edge profile.
 *
 * Why Playwright at all: per this repo's README, `deleteProjectV2Workflow` is
 * the ONLY GraphQL field that touches project workflows — there is no query
 * to list/read a workflow's configuration and no mutation to create or edit
 * one. Auto-add-to-project is UI-only, exactly like view creation/layout in
 * lib/tools-views.mjs, so this file follows that file's pattern: CDP-attach,
 * semantic selectors first, fragile ones isolated below for a future
 * hardening pass, fail closed rather than report a silent success.
 *
 * No gh_project_workflow_delete here: deleteProjectV2Workflow needs the
 * workflow's GraphQL node ID, and there is no read path (API or otherwise
 * verified against the live DOM) to obtain one. Add it once a real
 * ID-acquisition path is confirmed against the live UI.
 */
import { z } from 'zod';
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CDP_PORT, launchEdgeWithCDP, delay, screenshot } from './cdp.mjs';

function text(t) {
  return { content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] };
}
function errorText(err) {
  return { isError: true, content: [{ type: 'text', text: err.message ?? String(err) }] };
}

// ── Centralized selectors (same convention as tools-views.mjs SEL) ───────────
// Prefer page.getByRole/getByText/getByLabel in the functions below. Raw
// string selectors that remain live here, FRAGILE ones flagged, so a future
// drift canary has one place to look when GitHub's markup shifts.
const SEL = {
  workflowsListReady: '[role="list"], [role="listitem"], main',   // something has rendered on the Workflows page
  // FRAGILE (generated-class substring) — no stable role/label observed for the
  // repo-picker combobox as of writing; replace under the canary once verified live.
  repoPickerFragile: 'input[placeholder*="repository" i], input[aria-label*="repository" i]',
};

// Resolve user vs organization for the correct project URL prefix — unlike
// tools-views.mjs's withProjectPage (hardcoded to /users/), this matters here
// because the target use case is an ORG-owned project (EMBLEM-NLP/…/projects/3).
function ownerRoot(owner) {
  try {
    const r = spawnSync('gh', ['api', `users/${owner}`, '--jq', '.type'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim() === 'Organization') return 'organization';
  } catch { /* fall through */ }
  return 'user';
}

function projectWorkflowsUrl(owner, number) {
  const seg = ownerRoot(owner) === 'organization' ? 'orgs' : 'users';
  return `https://github.com/${seg}/${owner}/projects/${number}/workflows`;
}

async function getWorkflowsPage(browser, workflowsUrl) {
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
  await page.goto(workflowsUrl, { waitUntil: 'load', timeout: 60_000 });
  try { await page.keyboard.press('Escape'); await delay(300); } catch { /* ignore */ }
  await page.waitForSelector(SEL.workflowsListReady, { timeout: 30_000 });
  return page;
}

async function openWorkflow(page, workflowName) {
  // The workflows page lists workflow cards/rows by name (e.g. "Auto-add to
  // project", "Item closed", "Auto-close issue"). Try role-based matches
  // first (link or generic clickable row), then plain text as a fallback.
  const strategies = [
    () => page.getByRole('link', { name: new RegExp(workflowName, 'i') }),
    () => page.getByRole('button', { name: new RegExp(workflowName, 'i') }),
    () => page.getByText(new RegExp(`^${workflowName}$`, 'i')).first(),
  ];
  for (const strategy of strategies) {
    try {
      const el = strategy();
      if (await el.isVisible({ timeout: 3000 })) {
        await el.click();
        await page.waitForTimeout(800);
        return;
      }
    } catch { /* try next */ }
  }
  throw new Error(`Could not find a "${workflowName}" workflow on this project's Workflows page.`);
}

async function setWorkflowRepo(page, repo) {
  const strategies = [
    () => page.getByRole('button', { name: /add repository|choose a repository|filter by repository/i }),
    () => page.locator(SEL.repoPickerFragile).first(),
  ];
  let opened = false;
  for (const strategy of strategies) {
    try {
      const el = strategy();
      if (await el.isVisible({ timeout: 3000 })) {
        await el.click();
        await page.waitForTimeout(400);
        opened = true;
        break;
      }
    } catch { /* try next */ }
  }
  if (!opened) throw new Error('Could not find a repository picker in this workflow panel — the UI may have changed; see the saved screenshot.');

  await page.keyboard.type(repo);
  await page.waitForTimeout(800);

  const [, repoNameOnly] = repo.includes('/') ? repo.split('/') : [null, repo];
  const option = page.getByRole('option', { name: new RegExp(repoNameOnly, 'i') })
    .or(page.getByRole('menuitem', { name: new RegExp(repoNameOnly, 'i') }));
  if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
    await option.click();
    await page.waitForTimeout(400);
  } else {
    // Some pickers accept the typed value directly (Enter to confirm).
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
  }
  try { await page.keyboard.press('Escape'); } catch { /* ignore */ }
}

function filterInputLocator(page) {
  return page.getByPlaceholder(/filter/i).or(page.locator('input[aria-label*="filter" i]'));
}

// Always runs, even with an empty/omitted filterText — omitting the filter
// means "every issue and PR," which requires actively CLEARING any filter the
// workflow already has, not skipping this step. Skipping left a previously
// set filter in place while the tool reported "(none — every issue and PR)".
async function setWorkflowFilter(page, filterText) {
  const input = filterInputLocator(page);
  if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
    await input.fill(filterText ?? '');
    await page.waitForTimeout(300);
  } else {
    throw new Error('Could not find a filter input in this workflow panel to apply the requested filter.');
  }
}

// Read back the filter input's current value for verification. Returns null
// when the input can't be located, which the caller treats as "not verified"
// rather than assuming the filter is correct.
async function readWorkflowFilter(page) {
  const input = filterInputLocator(page);
  if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
    return await input.inputValue();
  }
  return null;
}

async function enableAndSaveWorkflow(page) {
  // Enable toggle, if the workflow was previously off.
  try {
    const toggle = page.getByRole('switch', { name: /enable|on\b/i })
      .or(page.getByRole('checkbox', { name: /enable/i }));
    if (await toggle.isVisible({ timeout: 2000 })) {
      const checked = await toggle.isChecked().catch(() => null);
      if (checked === false) { await toggle.click(); await page.waitForTimeout(300); }
    }
  } catch { /* no explicit enable toggle on this workflow type */ }

  const saveBtn = page.getByRole('button', { name: /^save$|^update$/i });
  if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await saveBtn.click();
    await page.waitForTimeout(1000);
  } else {
    throw new Error('Could not find a Save/Update button for this workflow panel.');
  }
}

async function withWorkflowsPage(owner, number, fn) {
  const workflowsUrl = projectWorkflowsUrl(owner, number);
  await launchEdgeWithCDP(workflowsUrl);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  try {
    const page = await getWorkflowsPage(browser, workflowsUrl);
    const title = await page.title();
    if (title.toLowerCase().includes('sign in') || title.toLowerCase().includes('login')) {
      throw new Error('Not authenticated in Edge. Log into GitHub in the Edge browser window and retry.');
    }
    return await fn(page, workflowsUrl);
  } finally {
    await browser.close();
  }
}

/**
 * gh_project_workflow_autoadd_configure handler, with the Playwright driver
 * injected so the plumbing (arg forwarding, default workflow name, result
 * shape) can be unit-tested without launching a browser.
 */
export function makeWorkflowAutoaddHandler(withWorkflowsPageFn) {
  return async ({ owner, number, repo, filter, workflowName }) => {
    try {
      const name = workflowName ?? 'Auto-add to project';
      const result = await withWorkflowsPageFn(owner, number, async (page, workflowsUrl) => {
        await openWorkflow(page, name);
        await setWorkflowRepo(page, repo);
        await setWorkflowFilter(page, filter);
        await enableAndSaveWorkflow(page);

        // Fail closed (same discipline as gh_project_view_create's `verified`
        // field): re-open the panel and confirm BOTH the repo and the filter
        // we set are still reflected, instead of trusting the Save click
        // silently succeeded — checking only the repo let a rejected or
        // unsaved filter edit report verified:true with the old filter intact.
        const expectedFilter = filter ?? '';
        let verified = false;
        let mismatchReason = 'panel state could not be read after saving';
        try {
          await page.goto(workflowsUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          await page.waitForTimeout(1000);
          await openWorkflow(page, name);
          const bodyText = await page.evaluate(() => document.body.innerText);
          const repoMatches = bodyText.includes(repo) || bodyText.includes(repo.split('/')[1]);
          const actualFilter = await readWorkflowFilter(page);
          const filterMatches = actualFilter !== null && actualFilter.trim() === expectedFilter.trim();
          verified = repoMatches && filterMatches;
          if (!repoMatches) mismatchReason = `repo not reflected (expected ${repo})`;
          else if (!filterMatches) mismatchReason = `filter not reflected (expected "${expectedFilter}", found "${actualFilter}")`;
        } catch { verified = false; }

        if (!verified) {
          const shotPath = await screenshot(page, `workflow-autoadd-${owner}-${number}`, join(tmpdir(), 'gh-projects-mcp'));
          throw new Error(
            `Could not verify "${name}" now targets ${repo} with filter "${expectedFilter || '(none)'}" after ` +
            `saving — ${mismatchReason}. Screenshot saved to ${shotPath} for debugging.`,
          );
        }
        return { configured: repo, filter: filter ?? '(none — every issue and PR)', workflow: name, verified };
      });
      return text(result);
    } catch (err) {
      return errorText(err);
    }
  };
}

export function registerWorkflowTools(server) {
  server.tool(
    'gh_project_workflow_autoadd_configure',
    'Configure the "Auto-add to project" built-in workflow so every issue/PR opened in a given repo (optionally filtered) is automatically added to this project. Drives GitHub\'s Workflows settings panel via Playwright/CDP in your existing logged-in Edge — there is no GraphQL/REST mutation for project workflows (only deleteProjectV2Workflow exists). Requires the local Edge+CDP setup described in this repo\'s README; cannot run from a session with no browser access.',
    {
      owner: z.string().describe('Project owner login (user or org)'),
      number: z.number().describe('Project number, e.g. 3'),
      repo: z.string().describe('Repository to auto-add from, as "owner/repo"'),
      filter: z.string().optional().describe('GitHub Projects filter syntax to restrict which issues/PRs qualify. Omit for every issue and PR (no filter).'),
      workflowName: z.string().optional().describe('Name of the workflow card on the Workflows page. Default "Auto-add to project" (GitHub\'s own default name).'),
    },
    makeWorkflowAutoaddHandler(withWorkflowsPage),
  );
}
