import { chromium } from 'playwright';
import { CDP_PORT, launchEdgeWithCDP } from './cdp.mjs';

async function findGitHubPage(browser) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (page.url().includes('github.com')) return page;
    }
  }
  const context = browser.contexts()[0];
  if (!context) throw new Error('No browser context is available in the attached Edge session.');
  return context.newPage();
}

async function savePendingViewChanges(page) {
  try {
    const save = page.getByRole('button', { name: /^save$/i }).first();
    if (await save.isVisible({ timeout: 1200 })) {
      await save.click();
      await page.waitForTimeout(500);
    }
  } catch { /* GitHub may auto-save this setting. */ }
  try {
    const confirm = page.locator('#__primerPortalRoot__ button:has-text("Save")').first();
    if (await confirm.isVisible({ timeout: 800 })) {
      await confirm.click();
      await page.waitForTimeout(400);
    }
  } catch { /* no second confirmation */ }
}

async function selectGroupBy(page, fieldName) {
  const buttons = [
    () => page.getByRole('button', { name: /group\s*by/i }).first(),
    () => page.locator('button[aria-label*="group by" i]').first(),
    () => page.locator('button:has-text("Group by")').first(),
  ];
  let opened = false;
  for (const getButton of buttons) {
    try {
      const button = getButton();
      if (await button.isVisible({ timeout: 1500 })) {
        await button.click();
        await page.waitForTimeout(300);
        opened = true;
        break;
      }
    } catch { /* try next locator */ }
  }
  if (!opened) throw new Error(`Could not open the Group by control while configuring "${fieldName}".`);

  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}$`, 'i');
  const candidates = [
    () => page.getByRole('option', { name: pattern }).first(),
    () => page.getByRole('menuitem', { name: pattern }).first(),
    () => page.locator(`[role="option"]:has-text("${fieldName}")`).first(),
  ];
  for (const getCandidate of candidates) {
    try {
      const candidate = getCandidate();
      if (await candidate.isVisible({ timeout: 1500 })) {
        await candidate.click();
        await page.waitForTimeout(350);
        await savePendingViewChanges(page);
        return;
      }
    } catch { /* try next */ }
  }
  throw new Error(`Could not select Group by field "${fieldName}".`);
}

/**
 * Preflight the only remaining browser-backed view setting before API mutations begin.
 * This is deliberately separate from normal view CRUD so API-supported operations never touch Edge.
 */
export async function preflightViewGroupByUi(projectUrl) {
  await launchEdgeWithCDP(projectUrl);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const page = await findGitHubPage(browser);
  await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const title = (await page.title()).toLowerCase();
  if (title.includes('sign in') || title.includes('login')) {
    throw new Error('Not authenticated in the attached Edge session. Sign in to github.com and retry.');
  }
  // Do not call browser.close(): this is a user-owned Edge process attached over CDP.
  return true;
}

/** Apply only the groupBy setting that GraphQL still cannot mutate. */
export async function applyViewGroupByUi(projectUrl, specs) {
  if (!specs.length) return [];
  await launchEdgeWithCDP(projectUrl);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const page = await findGitHubPage(browser);
  const applied = [];

  for (const spec of specs) {
    await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const tab = page.getByRole('tab', { name: new RegExp(`^${spec.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).first();
    if (!await tab.isVisible({ timeout: 10_000 })) throw new Error(`Could not find view tab "${spec.name}" for group-by fallback.`);
    await tab.click();
    await page.waitForTimeout(500);
    await selectGroupBy(page, spec.groupBy);
    applied.push({ view: spec.name, groupBy: spec.groupBy });
  }

  // Intentionally leave the user-owned Edge process running.
  return applied;
}
