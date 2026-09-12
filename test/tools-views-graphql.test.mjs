import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeViewCreateHandler,
  makeViewEditHandler,
  makeViewDeleteHandler,
} from '../lib/tools-views-graphql.mjs';

function responseJson(response) {
  return JSON.parse(response.content[0].text);
}

function view({ id = 'V1', name = 'Board', number = 2, layout = 'BOARD_LAYOUT', filter = '', visibleFields = [], groupByFields = [] } = {}) {
  return { id, name, number, layout, layoutName: layout.replace('_LAYOUT', '').toLowerCase(), filter, visibleFields, groupByFields, verticalGroupByFields: [] };
}

test('ordinary gh_project_view_create uses API only and never calls browser fallback', async () => {
  const browserCalls = [];
  const final = view({ name: 'Active', layout: 'TABLE_LAYOUT', filter: 'is:open' });
  let readCount = 0;
  const api = {
    readProject() {
      readCount += 1;
      return readCount === 1
        ? { id: 'P1', url: 'https://github.com/orgs/o/projects/1', views: [] }
        : { id: 'P1', url: 'https://github.com/orgs/o/projects/1', views: [final] };
    },
    createView(owner, number, spec) {
      assert.equal(owner, 'o'); assert.equal(number, 1); assert.equal(spec.name, 'Active');
      return final;
    },
    deleteView() { throw new Error('unexpected delete'); },
    updateView() { throw new Error('unexpected update'); },
  };
  const handler = makeViewCreateHandler({
    api,
    preflightGroupBy: async () => browserCalls.push('preflight'),
    applyGroupBy: async () => browserCalls.push('apply'),
  });
  const response = await handler({ owner: 'o', number: 1, views: [{ name: 'Active', layout: 'table', filter: 'is:open' }] });
  assert.equal(response.isError, undefined);
  assert.deepEqual(browserCalls, []);
  assert.equal(responseJson(response).created, 1);
});

test('groupBy explicitly preflights browser before API writes and applies fallback afterward', async () => {
  const order = [];
  const grouped = view({ name: 'Board', groupByFields: [{ id: 'F1', name: 'Status' }] });
  let readCount = 0;
  const api = {
    readProject() {
      readCount += 1;
      return readCount === 1
        ? { id: 'P1', url: 'https://github.com/orgs/o/projects/1', views: [] }
        : { id: 'P1', url: 'https://github.com/orgs/o/projects/1', views: [grouped] };
    },
    createView() { order.push('create'); return view(); },
    deleteView() { order.push('delete'); },
    updateView() { order.push('update'); },
  };
  const handler = makeViewCreateHandler({
    api,
    preflightGroupBy: async () => { order.push('preflight'); },
    applyGroupBy: async (_url, specs) => { order.push('apply'); return specs.map((spec) => ({ view: spec.name, groupBy: spec.groupBy })); },
  });
  const response = await handler({ owner: 'o', number: 1, views: [{ name: 'Board', layout: 'board', groupBy: 'Status' }] });
  assert.equal(response.isError, undefined);
  assert.deepEqual(order, ['preflight', 'create', 'apply']);
  assert.equal(responseJson(response).groupByApplied[0].groupBy, 'Status');
});

test('reapply updates API-backed settings instead of deleting and recreating a layout mismatch', async () => {
  const initial = view({ id: 'V9', name: 'Queue', layout: 'TABLE_LAYOUT' });
  const updated = view({ id: 'V9', name: 'Queue', layout: 'BOARD_LAYOUT', filter: '-status:Done' });
  let reads = 0;
  const calls = [];
  const api = {
    readProject() {
      reads += 1;
      return { id: 'P1', url: 'u', views: [reads === 1 ? initial : updated] };
    },
    updateView(_owner, _number, input) { calls.push(['update', input]); return updated; },
    createView() { calls.push(['create']); },
    deleteView() { calls.push(['delete']); },
  };
  const response = await makeViewCreateHandler({ api })({
    owner: 'o', number: 1, reapply: true,
    views: [{ name: 'Queue', layout: 'board', filter: '-status:Done' }],
  });
  assert.equal(response.isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'update');
});

test('gh_project_view_edit changes API-backed settings without browser when groupBy is absent', async () => {
  const browserCalls = [];
  const before = view({ id: 'V2', name: 'Old', layout: 'TABLE_LAYOUT' });
  const after = view({ id: 'V2', name: 'New', layout: 'BOARD_LAYOUT', filter: 'is:open' });
  let reads = 0;
  const api = {
    readProject() {
      reads += 1;
      return { id: 'P1', url: 'u', views: [reads === 1 ? before : after] };
    },
    updateView(_owner, _number, input) {
      assert.deepEqual(input, { viewId: 'V2', name: 'New', layout: 'board', filter: 'is:open' });
      return after;
    },
  };
  const response = await makeViewEditHandler({
    api,
    preflightGroupBy: async () => browserCalls.push('preflight'),
    applyGroupBy: async () => browserCalls.push('apply'),
  })({ owner: 'o', number: 1, viewName: 'Old', name: 'New', layout: 'board', filter: 'is:open' });
  assert.equal(response.isError, undefined);
  assert.deepEqual(browserCalls, []);
  assert.equal(responseJson(response).view.name, 'New');
});

test('groupBy-only edit uses browser fallback without requiring an API mutation', async () => {
  const before = view({ id: 'V2', name: 'Board', groupByFields: [] });
  const after = view({ id: 'V2', name: 'Board', groupByFields: [{ id: 'F1', name: 'Status' }] });
  let reads = 0;
  let apiUpdates = 0;
  const order = [];
  const api = {
    readProject() {
      reads += 1;
      return { id: 'P1', url: 'u', views: [reads === 1 ? before : after] };
    },
    updateView() { apiUpdates += 1; },
  };
  const response = await makeViewEditHandler({
    api,
    preflightGroupBy: async () => order.push('preflight'),
    applyGroupBy: async () => { order.push('apply'); return [{ view: 'Board', groupBy: 'Status' }]; },
  })({ owner: 'o', number: 1, viewName: 'Board', groupBy: 'Status' });
  assert.equal(response.isError, undefined);
  assert.equal(apiUpdates, 0);
  assert.deepEqual(order, ['preflight', 'apply']);
});

test('gh_project_view_delete refuses before API deletion unless confirm:true', async () => {
  let deletes = 0;
  const api = { deleteView() { deletes += 1; return { id: 'V1', name: 'Board', deleted: true }; } };
  const handler = makeViewDeleteHandler({ api });
  const refused = await handler({ owner: 'o', number: 1, viewName: 'Board', confirm: false });
  assert.equal(refused.isError, true);
  assert.equal(deletes, 0);
  const accepted = await handler({ owner: 'o', number: 1, viewName: 'Board', confirm: true });
  assert.equal(accepted.isError, undefined);
  assert.equal(deletes, 1);
});
