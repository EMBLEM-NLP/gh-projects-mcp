/**
 * #64 — browser-ui entry points must fail closed with a structured
 * `capability_unavailable` error on any non-win32 runtime, using their real
 * (non-injected) wiring — i.e. without a caller having to know to stub
 * anything about Playwright/CDP. This is what lets Codex/container/hosted
 * environments call these tools and get a clear, immediate answer instead of
 * a multi-second CDP timeout or an attempted Playwright import.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerWorkflowTools } from '../lib/tools-workflows.mjs';
import { makeViewCreateHandler, makeViewEditHandler } from '../lib/tools-views-graphql.mjs';

const onWin32 = process.platform === 'win32';
const skip = onWin32 ? 'browser-ui is not statically unavailable on win32 — this asserts non-win32 fail-closed behaviour' : false;

function fakeServer() {
  const tools = new Map();
  return {
    tool(name, _description, _schema, handler) { tools.set(name, handler); },
    get(name) { return tools.get(name); },
  };
}

test('gh_project_workflow_autoadd_configure fails closed on a non-win32 runtime without touching Edge/CDP or Playwright', { skip }, async () => {
  const server = fakeServer();
  registerWorkflowTools(server);
  const handler = server.get('gh_project_workflow_autoadd_configure');
  const start = Date.now();
  const result = await handler({ owner: 'o', number: 1, repo: 'o/r' });
  const elapsedMs = Date.now() - start;
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /capability_unavailable: browser-ui/);
  // A real CDP attach attempt waits ~3s before giving up; failing closed here must be near-instant.
  assert.ok(elapsedMs < 1000, `expected a fast fail-closed rejection, took ${elapsedMs}ms`);
});

function view({ id = 'V1', name = 'Board', layout = 'BOARD_LAYOUT', groupByFields = [] } = {}) {
  return { id, name, number: 2, layout, layoutName: layout.replace('_LAYOUT', '').toLowerCase(), filter: '', visibleFields: [], groupByFields, verticalGroupByFields: [] };
}

test('gh_project_view_create groupBy fails closed on a non-win32 runtime before any API write', { skip }, async () => {
  let createCalled = false;
  const api = {
    readProject: () => ({ id: 'P1', url: 'https://github.com/orgs/o/projects/1', views: [] }),
    createView: () => { createCalled = true; return view(); },
    updateView: () => { createCalled = true; },
    deleteView: () => { createCalled = true; },
  };
  const handler = makeViewCreateHandler({ api }); // real (non-injected) preflightGroupBy/applyGroupBy
  const result = await handler({ owner: 'o', number: 1, views: [{ name: 'Board', layout: 'board', groupBy: 'Status' }] });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /capability_unavailable: browser-ui/);
  assert.equal(createCalled, false, 'no API write should happen once the capability gate has refused');
});

test('gh_project_view_edit groupBy fails closed on a non-win32 runtime before any API write', { skip }, async () => {
  let updateCalled = false;
  const api = {
    readProject: () => ({ id: 'P1', url: 'u', views: [view({ name: 'Board' })] }),
    updateView: () => { updateCalled = true; },
  };
  const handler = makeViewEditHandler({ api }); // real (non-injected) preflightGroupBy/applyGroupBy
  const result = await handler({ owner: 'o', number: 1, viewName: 'Board', groupBy: 'Status' });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /capability_unavailable: browser-ui/);
  assert.equal(updateCalled, false);
});

test('non-groupBy view create/edit are unaffected by the browser-ui gate on any platform', async () => {
  const created = view({ name: 'Active', layout: 'TABLE_LAYOUT' });
  let reads = 0;
  const api = {
    readProject: () => {
      reads += 1;
      return { id: 'P1', url: 'u', views: reads === 1 ? [] : [created] };
    },
    createView: () => created,
  };
  const result = await makeViewCreateHandler({ api })({ owner: 'o', number: 1, views: [{ name: 'Active', layout: 'table' }] });
  assert.equal(result.isError, undefined);
});
