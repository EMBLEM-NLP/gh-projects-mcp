/**
 * GitHub Projects workflow authoring that is still UI-only.
 * Browser code is loaded lazily so normal API-backed server startup remains headless-safe.
 */
import { z } from 'zod';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gh } from './gql.mjs';
import { makeOwnerRoot } from './helpers.mjs';
import { CDP_PORT, launchEdgeWithCDP, delay, screenshot } from './cdp.mjs';

const resolveOwnerRoot = makeOwnerRoot(gh);

function text(value) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

function errorText(error) {
  return { isError: true, content: [{ type: 'text', text: error?.message ?? String(error) }] };
}

const SEL = {
  workflowsListReady: '[role="list"], [role="listitem"], main',
  repoPickerFragile: 'input[placeholder*="repository" i], input[aria-label*="repository" i]',
  filterInput: 'input[aria-label*="filter" i]',
};

function projectWorkflowsUrl(owner, number) {
  const segment = resolveOwnerRoot(owner) === 'organization' ? 'orgs' : 'users';
  return `https://github.com/${segment}/${owner}/projects/${number}/workflows`;
}

async function getWorkflowsPage(browser, workflowsUrl) {
  let page;
  outer: for (const context of browser.contexts()) {
    for (const candidate of context.pages()) {
      if (candidate.url().includes('github.com')) {
        page = candidate;
        break outer;
      }
    }
  }
  if (!page) {
    const context = browser.contexts()[0] ?? await browser.newContext();
    page = await context.newPage();
  }
  await page.goto(workflowsUrl, { waitUntil: 'load', timeout: 60_000 });
  try {
    await page.keyboard.press('Escape');
    await delay(300);
  } catch { /* ignore */ }
  await page.waitForSelector(SEL.workflowsListReady, { timeout: 30_000 });
  return page;
}

async function openWorkflow(page, workflowName) {
  const strategies = [
    () => page.getByRole('link', { name: new RegExp(workflowName, 'i') }),
    () => page.getByRole('button', { name: new RegExp(workflowName, 'i') }),
    () => page.getByText(new RegExp(`^${workflowName}$`, 'i')).first(),
  ];
  for (const strategy of strategies) {
    try {
      const element = strategy();
      if (await element.isVisible({ timeout: 3000 })) {
        await element.click();
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
      const element = strategy();
      if (await element.isVisible({ timeout: 3000 })) {
        await element.click();
        await page.waitForTimeout(400);
        opened = true;
        break;
      }
    } catch { /* try next */ }
  }
  if (!opened) throw new Error('Could not find the workflow repository picker.');

  await page.keyboard.type(repo);
  await page.waitForTimeout(800);
  const repoName = repo.includes('/') ? repo.split('/')[1] : repo;
  const option = page.getByRole('option', { name: new RegExp(repoName, 'i') })
    .or(page.getByRole('menuitem', { name: new RegExp(repoName, 'i') }));
  if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
    await option.click();
  } else {
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(400);
  try { await page.keyboard.press('Escape'); } catch { /* ignore */ }
}

function workflowFilterInput(page) {
  return page.getByPlaceholder(/filter/i).or(page.locator(SEL.filterInput));
}

async function setWorkflowFilter(page, filterText = '') {
  const input = workflowFilterInput(page);
  if (!await input.isVisible({ timeout: 3000 }).catch(() => false)) {
    throw new Error('Could not find the workflow filter input.');
  }
  await input.fill(filterText ?? '');
  await page.waitForTimeout(300);
}

async function enableAndSaveWorkflow(page) {
  try {
    const toggle = page.getByRole('switch', { name: /enable|on\b/i })
      .or(page.getByRole('checkbox', { name: /enable/i }));
    if (await toggle.isVisible({ timeout: 2000 })) {
      const checked = await toggle.isChecked().catch(() => null);
      if (checked === false) {
        await toggle.click();
        await page.waitForTimeout(300);
      }
    }
  } catch { /* workflow type may not expose an explicit toggle */ }

  const saveButton = page.getByRole('button', { name: /^save$|^update$/i });
  if (!await saveButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    throw new Error('Could not find a Save/Update button for this workflow panel.');
  }
  await saveButton.click();
  await page.waitForTimeout(1000);
}

async function readWorkflowVerification(page, repo, expectedFilter) {
  const bodyText = await page.evaluate(() => document.body.innerText);
  const repoName = repo.includes('/') ? repo.split('/')[1] : repo;
  const repoVerified = bodyText.includes(repo) || bodyText.includes(repoName);

  const input = workflowFilterInput(page);
  const visible = await input.isVisible({ timeout: 3000 }).catch(() => false);
  const actualFilter = visible ? await input.inputValue() : null;
  const filterVerified = actualFilter !== null && actualFilter.trim() === expectedFilter.trim();

  return {
    verified: repoVerified && filterVerified,
    repoVerified,
    filterVerified,
    actualFilter,
  };
}

async function withWorkflowsPage(owner, number, fn) {
  const workflowsUrl = projectWorkflowsUrl(owner, number);
  await launchEdgeWithCDP(workflowsUrl);
  const { chromium } = await import('playwright');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  try {
    const page = await getWorkflowsPage(browser, workflowsUrl);
    const title = await page.title();
    if (title.toLowerCase().includes('sign in') || title.toLowerCase().includes('login')) {
      throw new Error('Not authenticated in Edge. Log into GitHub in Edge and retry.');
    }
    return await fn(page, workflowsUrl);
  } finally {
    await browser.close();
  }
}

const defaultOperations = {
  openWorkflow,
  setWorkflowRepo,
  setWorkflowFilter,
  enableAndSaveWorkflow,
  readWorkflowVerification,
};

export function makeWorkflowAutoaddHandler(withWorkflowsPageFn, operations = defaultOperations) {
  return async ({ owner, number, repo, filter, workflowName }) => {
    try {
      const name = workflowName ?? 'Auto-add to project';
      const expectedFilter = filter ?? '';
      const result = await withWorkflowsPageFn(owner, number, async (page, workflowsUrl) => {
        await operations.openWorkflow(page, name);
        await operations.setWorkflowRepo(page, repo);
        // Omission means "no filter", so always write the desired value. This
        // deliberately clears any previously configured filter when omitted.
        await operations.setWorkflowFilter(page, expectedFilter);
        await operations.enableAndSaveWorkflow(page);

        let verification;
        try {
          await page.goto(workflowsUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          await page.waitForTimeout(1000);
          await operations.openWorkflow(page, name);
          verification = await operations.readWorkflowVerification(page, repo, expectedFilter);
        } catch {
          verification = { verified: false, repoVerified: false, filterVerified: false, actualFilter: null };
        }

        if (!verification.verified) {
          const shotPath = await screenshot(page, `workflow-autoadd-${owner}-${number}`, join(tmpdir(), 'gh-projects-mcp'));
          throw new Error(
            `Could not verify "${name}" after saving. repoVerified=${verification.repoVerified}; ` +
            `filterVerified=${verification.filterVerified}; actualFilter=${JSON.stringify(verification.actualFilter)}. ` +
            `Screenshot saved to ${shotPath}.`,
          );
        }

        return {
          configured: repo,
          filter: filter ?? '(none — every issue and PR)',
          workflow: name,
          verified: true,
          verification: {
            repo: verification.repoVerified,
            filter: verification.filterVerified,
            actualFilter: verification.actualFilter,
          },
        };
      });
      return text(result);
    } catch (error) {
      return errorText(error);
    }
  };
}

export function registerWorkflowTools(server) {
  server.tool(
    'gh_project_workflow_autoadd_configure',
    'Configure GitHub Projects "Auto-add to project" through the browser-only Workflows UI. Omit filter to explicitly clear any existing filter and include every issue/PR. Requires local logged-in Edge/CDP and verifies both repository and filter after save.',
    {
      owner: z.string().describe('Project owner login (user or organization)'),
      number: z.number().int().positive().describe('Project number'),
      repo: z.string().describe('Repository to auto-add from, as owner/repo'),
      filter: z.string().optional().describe('GitHub Projects filter syntax. Omit to clear any existing filter.'),
      workflowName: z.string().optional().describe('Workflow card name; defaults to Auto-add to project'),
    },
    makeWorkflowAutoaddHandler(withWorkflowsPage),
  );
}
