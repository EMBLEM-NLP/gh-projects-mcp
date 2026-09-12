import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkflowAutoaddHandler } from '../lib/tools-workflows.mjs';

test('gh_project_workflow_autoadd_configure forwards owner/number and drives the injected page runner', async () => {
  const seen = [];
  const withWorkflowsPage = async (owner, number, fn) => {
    seen.push({ owner, number, fnIsFunction: typeof fn === 'function' });
    return { configured: 'EMBLEM-NLP/karaoke-claude-narration', filter: '(none — every issue and PR)', workflow: 'Auto-add to project', verified: true };
  };
  const res = await makeWorkflowAutoaddHandler(withWorkflowsPage)({
    owner: 'EMBLEM-NLP',
    number: 3,
    repo: 'EMBLEM-NLP/karaoke-claude-narration',
  });
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /"configured": "EMBLEM-NLP\/karaoke-claude-narration"/);
  assert.match(res.content[0].text, /"verified": true/);
  assert.deepEqual(seen, [{ owner: 'EMBLEM-NLP', number: 3, fnIsFunction: true }]);
});

// No live page is available in CI, so this doesn't reach a real DOM — but
// openWorkflow() (module-internal) fails closed with an error that NAMES the
// workflow it was looking for, which is enough to prove the default/override
// plumbing without a browser: whatever name reaches openWorkflow() surfaces
// verbatim in the thrown message.
test('gh_project_workflow_autoadd_configure defaults workflowName to "Auto-add to project"', async () => {
  const passthroughPage = { getByRole: () => { throw new Error('no page'); }, getByText: () => { throw new Error('no page'); } };
  const withWorkflowsPage = (owner, number, fn) => fn(passthroughPage, 'https://github.com/orgs/EMBLEM-NLP/projects/3/workflows');
  const res = await makeWorkflowAutoaddHandler(withWorkflowsPage)({
    owner: 'EMBLEM-NLP',
    number: 3,
    repo: 'EMBLEM-NLP/karaoke-claude-narration',
  });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /Could not find a "Auto-add to project" workflow/);
});

test('gh_project_workflow_autoadd_configure honors an explicit workflowName override', async () => {
  const passthroughPage = { getByRole: () => { throw new Error('no page'); }, getByText: () => { throw new Error('no page'); } };
  const withWorkflowsPage = (owner, number, fn) => fn(passthroughPage, 'https://github.com/orgs/EMBLEM-NLP/projects/3/workflows');
  const res = await makeWorkflowAutoaddHandler(withWorkflowsPage)({
    owner: 'EMBLEM-NLP',
    number: 3,
    repo: 'EMBLEM-NLP/karaoke-claude-narration',
    workflowName: 'Item added to project',
  });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /Could not find a "Item added to project" workflow/);
});

test('gh_project_workflow_autoadd_configure surfaces driver errors without throwing', async () => {
  const withWorkflowsPage = async () => { throw new Error('No Edge DevTools endpoint on 127.0.0.1:9222.'); };
  const res = await makeWorkflowAutoaddHandler(withWorkflowsPage)({
    owner: 'EMBLEM-NLP',
    number: 3,
    repo: 'EMBLEM-NLP/karaoke-claude-narration',
  });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /No Edge DevTools endpoint/);
});
