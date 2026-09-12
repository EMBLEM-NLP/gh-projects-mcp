import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeProjectViewApi } from '../lib/view-api.mjs';

function rawView({
  id = 'V1', name = 'Board', number = 2, layout = 'BOARD_LAYOUT', filter = '',
  visibleFieldIds = [], groupBy = [], verticalGroupBy = [],
} = {}) {
  const fieldNode = (value) => typeof value === 'string'
    ? { __typename: 'ProjectV2Field', id: value, name: value, dataType: 'TEXT' }
    : value;
  return {
    id, name, number, layout, filter,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-02T00:00:00Z',
    configuration: { visibleFields: { nodes: visibleFieldIds.map(fieldNode) } },
    groupByFields: { nodes: groupBy.map(fieldNode) },
    verticalGroupByFields: { nodes: verticalGroupBy.map(fieldNode) },
  };
}

function projectResponse(views = []) {
  return {
    data: {
      organization: {
        projectV2: {
          id: 'P1',
          url: 'https://github.com/orgs/EMBLEM-NLP/projects/1',
          views: { nodes: views },
        },
      },
    },
  };
}

function gqlStub(responses) {
  const calls = [];
  const gql = (query) => {
    calls.push(query);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(query);
    return next;
  };
  gql.calls = calls;
  return gql;
}

function apiFor(responses) {
  const gql = gqlStub(responses);
  return { api: makeProjectViewApi({ gql, ownerRoot: () => 'organization' }), gql };
}

test('readProject returns stable view IDs and API-backed view configuration', () => {
  const view = rawView({
    visibleFieldIds: [{ __typename: 'ProjectV2Field', id: 'F1', name: 'Status', dataType: 'SINGLE_SELECT' }],
    groupBy: [{ __typename: 'ProjectV2SingleSelectField', id: 'F1', name: 'Status', dataType: 'SINGLE_SELECT' }],
  });
  const { api } = apiFor([projectResponse([view])]);
  const result = api.readProject('EMBLEM-NLP', 1);
  assert.equal(result.views[0].id, 'V1');
  assert.equal(result.views[0].layoutName, 'board');
  assert.deepEqual(result.views[0].visibleFields.map((field) => field.id), ['F1']);
  assert.equal(result.views[0].groupByFields[0].name, 'Status');
});

test('createView uses createProjectV2View with layout and ordered visible field IDs then verifies final state', () => {
  const created = rawView({ name: 'Active', layout: 'TABLE_LAYOUT', visibleFieldIds: ['F1', 'F2'] });
  const { api, gql } = apiFor([
    projectResponse([]),
    { data: { createProjectV2View: { projectV2View: created } } },
    projectResponse([created]),
  ]);
  const result = api.createView('EMBLEM-NLP', 1, {
    name: 'Active', layout: 'table', visibleFieldIds: ['F1', 'F2'],
  });
  assert.equal(result.name, 'Active');
  assert.match(gql.calls[1], /createProjectV2View/);
  assert.match(gql.calls[1], /layout: TABLE_LAYOUT/);
  assert.match(gql.calls[1], /visibleFieldIds: \["F1", "F2"\]/);
});

test('createView applies filter with updateProjectV2View because create input has no filter', () => {
  const initial = rawView({ name: 'Open', layout: 'TABLE_LAYOUT', filter: '' });
  const filtered = rawView({ name: 'Open', layout: 'TABLE_LAYOUT', filter: 'is:open' });
  const { api, gql } = apiFor([
    projectResponse([]),
    { data: { createProjectV2View: { projectV2View: initial } } },
    projectResponse([initial]),
    { data: { updateProjectV2View: { projectV2View: filtered } } },
    projectResponse([filtered]),
    projectResponse([filtered]),
  ]);
  const result = api.createView('EMBLEM-NLP', 1, { name: 'Open', layout: 'table', filter: 'is:open' });
  assert.equal(result.filter, 'is:open');
  assert.doesNotMatch(gql.calls[1], /filter:/);
  assert.match(gql.calls[3], /updateProjectV2View/);
  assert.match(gql.calls[3], /filter: "is:open"/);
});

test('updateView resolves by name, edits layout/filter/visible fields, and verifies the same view ID', () => {
  const current = rawView({ id: 'V9', name: 'Queue', layout: 'TABLE_LAYOUT' });
  const updated = rawView({ id: 'V9', name: 'Queue', layout: 'BOARD_LAYOUT', filter: '-status:Done', visibleFieldIds: ['F1'] });
  const { api, gql } = apiFor([
    projectResponse([current]),
    { data: { updateProjectV2View: { projectV2View: updated } } },
    projectResponse([updated]),
  ]);
  const result = api.updateView('EMBLEM-NLP', 1, {
    viewName: 'Queue', layout: 'board', filter: '-status:Done', visibleFieldIds: ['F1'],
  });
  assert.equal(result.id, 'V9');
  assert.match(gql.calls[1], /viewId: "V9"/);
  assert.match(gql.calls[1], /layout: BOARD_LAYOUT/);
  assert.match(gql.calls[1], /filter: "-status:Done"/);
});

test('deleteView resolves a name to ID, calls deleteProjectV2View, and verifies absence', () => {
  const current = rawView({ id: 'V7', name: 'Old' });
  const { api, gql } = apiFor([
    projectResponse([current]),
    { data: { deleteProjectV2View: { projectV2View: { id: 'V7', name: 'Old' } } } },
    projectResponse([]),
  ]);
  const result = api.deleteView('EMBLEM-NLP', 1, { viewName: 'Old' });
  assert.deepEqual(result, { id: 'V7', name: 'Old', deleted: true });
  assert.match(gql.calls[1], /deleteProjectV2View/);
  assert.match(gql.calls[1], /viewId: "V7"/);
});

test('createView fails closed when final API state does not match the requested layout', () => {
  const returned = rawView({ name: 'Board', layout: 'BOARD_LAYOUT' });
  const wrong = rawView({ name: 'Board', layout: 'TABLE_LAYOUT' });
  const { api } = apiFor([
    projectResponse([]),
    { data: { createProjectV2View: { projectV2View: returned } } },
    projectResponse([wrong]),
  ]);
  assert.throws(
    () => api.createView('EMBLEM-NLP', 1, { name: 'Board', layout: 'board' }),
    /verification failed/,
  );
});
