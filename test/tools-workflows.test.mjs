import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeWorkflowAutoaddHandler,
  setWorkflowFilter,
  readWorkflowVerification,
} from '../lib/tools-workflows.mjs';

function fakePage() {
  return {
    async goto() {},
    async waitForTimeout() {},
    async screenshot() {},
  };
}

function fakeFilterPage({ bodyText = 'EMBLEM-NLP/example', inputValue = '' } = {}) {
  let filled;
  const locator = {
    or() { return this; },
    async isVisible() { return true; },
    async fill(value) { filled = value; },
    async inputValue() { return inputValue; },
  };
  return {
    get filled() { return filled; },
    getByPlaceholder() { return locator; },
    locator() { return locator; },
    async waitForTimeout() {},
    async evaluate() { return bodyText; },
  };
}

function makeOperations(overrides = {}) {
  return {
    async openWorkflow() {},
    async setWorkflowRepo() {},
    async setWorkflowFilter() {},
    async enableAndSaveWorkflow() {},
    async readWorkflowVerification(_page, _repo, expectedFilter) {
      return { verified: true, repoVerified: true, filterVerified: true, actualFilter: expectedFilter };
    },
    ...overrides,
  };
}

function pageRunner(page = fakePage()) {
  return async (_owner, _number, fn) => fn(page, 'https://github.com/orgs/EMBLEM-NLP/projects/3/workflows');
}

test('setWorkflowFilter clears the DOM input when filter is omitted', async () => {
  const page = fakeFilterPage({ inputValue: 'old-filter' });
  await setWorkflowFilter(page, undefined);
  assert.equal(page.filled, '');
});

test('readWorkflowVerification requires both repository and filter to match', async () => {
  const stale = await readWorkflowVerification(
    fakeFilterPage({ bodyText: 'EMBLEM-NLP/example', inputValue: 'old-filter' }),
    'EMBLEM-NLP/example',
    'new-filter',
  );
  assert.equal(stale.repoVerified, true);
  assert.equal(stale.filterVerified, false);
  assert.equal(stale.verified, false);

  const current = await readWorkflowVerification(
    fakeFilterPage({ bodyText: 'EMBLEM-NLP/example', inputValue: 'new-filter' }),
    'EMBLEM-NLP/example',
    'new-filter',
  );
  assert.equal(current.verified, true);
});

test('omitting filter explicitly writes an empty filter to clear previous configuration', async () => {
  const seen = [];
  const operations = makeOperations({
    async setWorkflowFilter(_page, value) { seen.push(value); },
  });
  const result = await makeWorkflowAutoaddHandler(pageRunner(), operations)({
    owner: 'EMBLEM-NLP', number: 3, repo: 'EMBLEM-NLP/example',
  });
  assert.equal(result.isError, undefined);
  assert.deepEqual(seen, ['']);
  assert.match(result.content[0].text, /none — every issue and PR/);
});

test('explicit workflow filter is written and re-verified after save', async () => {
  const seen = [];
  const operations = makeOperations({
    async setWorkflowFilter(_page, value) { seen.push(value); },
    async readWorkflowVerification(_page, _repo, expectedFilter) {
      return { verified: true, repoVerified: true, filterVerified: true, actualFilter: expectedFilter };
    },
  });
  const result = await makeWorkflowAutoaddHandler(pageRunner(), operations)({
    owner: 'EMBLEM-NLP', number: 3, repo: 'EMBLEM-NLP/example', filter: 'is:issue label:ready',
  });
  assert.equal(result.isError, undefined);
  assert.deepEqual(seen, ['is:issue label:ready']);
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.verified, true);
  assert.equal(payload.verification.filter, true);
  assert.equal(payload.verification.actualFilter, 'is:issue label:ready');
});

test('repo match cannot hide a silently failed filter edit', async () => {
  const operations = makeOperations({
    async readWorkflowVerification() {
      return { verified: false, repoVerified: true, filterVerified: false, actualFilter: 'old-filter' };
    },
  });
  const page = fakePage();
  const result = await makeWorkflowAutoaddHandler(pageRunner(page), operations)({
    owner: 'EMBLEM-NLP', number: 3, repo: 'EMBLEM-NLP/example', filter: 'new-filter',
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /repoVerified=true/);
  assert.match(result.content[0].text, /filterVerified=false/);
  assert.match(result.content[0].text, /old-filter/);
});

test('workflowName override is forwarded to both configuration and verification opens', async () => {
  const names = [];
  const operations = makeOperations({
    async openWorkflow(_page, name) { names.push(name); },
  });
  const result = await makeWorkflowAutoaddHandler(pageRunner(), operations)({
    owner: 'EMBLEM-NLP', number: 3, repo: 'EMBLEM-NLP/example', workflowName: 'Custom auto-add',
  });
  assert.equal(result.isError, undefined);
  assert.deepEqual(names, ['Custom auto-add', 'Custom auto-add']);
});

test('driver errors surface as MCP errors instead of throwing', async () => {
  const handler = makeWorkflowAutoaddHandler(async () => { throw new Error('No Edge DevTools endpoint'); }, makeOperations());
  const result = await handler({ owner: 'EMBLEM-NLP', number: 3, repo: 'EMBLEM-NLP/example' });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /No Edge DevTools endpoint/);
});
