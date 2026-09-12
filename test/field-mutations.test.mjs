import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  configureIterationField,
  createProjectField,
  normalizeIterationConfiguration,
  reconcileFieldOptions,
  updateMultiSelectItemField,
  updateSelectFieldOptions,
} from '../lib/field-mutations.mjs';

function gqlStub(responses = []) {
  const queries = [];
  const gql = (query) => {
    queries.push(query);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(query);
    return next ?? { data: {} };
  };
  gql.queries = queries;
  return gql;
}

test('reconcileFieldOptions preserves identity and metadata for unchanged-name edits', () => {
  const current = [{ id: 'A', name: 'Todo', color: 'GRAY', description: 'old' }];
  const result = reconcileFieldOptions(current, [{ name: 'Todo', color: 'BLUE' }]);
  assert.deepEqual(result.options, [{ id: 'A', name: 'Todo', color: 'BLUE', description: 'old' }]);
  assert.deepEqual(result.removed, []);
});

test('reconcileFieldOptions infers one unambiguous rename and preserves its id', () => {
  const current = [{ id: 'A', name: 'Todo', color: 'GRAY', description: '' }];
  const result = reconcileFieldOptions(current, [{ name: 'Backlog' }]);
  assert.equal(result.options[0].id, 'A');
  assert.equal(result.options[0].name, 'Backlog');
});

test('reconcileFieldOptions requires explicit ids for ambiguous multiple renames', () => {
  const current = [
    { id: 'A', name: 'One', color: 'GRAY', description: '' },
    { id: 'B', name: 'Two', color: 'GRAY', description: '' },
  ];
  assert.throws(
    () => reconcileFieldOptions(current, [{ name: 'Alpha' }, { name: 'Beta' }]),
    /Ambiguous option rename\/addition/,
  );
});

test('reconcileFieldOptions reports removed ids and names and requires allowRemove', () => {
  const current = [
    { id: 'A', name: 'Keep', color: 'GRAY', description: '' },
    { id: 'B', name: 'Drop', color: 'RED', description: '' },
  ];
  assert.throws(
    () => reconcileFieldOptions(current, [{ name: 'Keep' }]),
    /B:Drop/,
  );
  const result = reconcileFieldOptions(current, [{ name: 'Keep' }], true);
  assert.deepEqual(result.removed.map(({ id, name }) => ({ id, name })), [{ id: 'B', name: 'Drop' }]);
});

test('updateSelectFieldOptions includes existing option ids in single-select mutation', () => {
  const gql = gqlStub([
    { data: { node: { __typename: 'ProjectV2SingleSelectField', id: 'F1', name: 'Status', options: [{ id: 'A', name: 'Todo', color: 'GRAY', description: '' }] } } },
    { data: { updateProjectV2Field: { projectV2Field: { __typename: 'ProjectV2SingleSelectField', id: 'F1', name: 'Status', options: [{ id: 'A', name: 'Backlog', color: 'BLUE', description: '' }] } } } },
  ]);
  const result = updateSelectFieldOptions(gql, 'F1', [{ name: 'Backlog', color: 'BLUE' }]);
  assert.match(gql.queries[1], /id: "A"/);
  assert.match(gql.queries[1], /singleSelectOptions/);
  assert.equal(result.field.options[0].id, 'A');
});

test('updateSelectFieldOptions uses multiSelectOptions for a multi-select field', () => {
  const gql = gqlStub([
    { data: { node: { __typename: 'ProjectV2MultiSelectField', id: 'F2', name: 'Areas', options: [{ id: 'M1', name: 'AV', color: 'PURPLE', description: '' }] } } },
    { data: { updateProjectV2Field: { projectV2Field: { __typename: 'ProjectV2MultiSelectField', id: 'F2', name: 'Areas', options: [{ id: 'M1', name: 'Audio', color: 'PURPLE', description: '' }] } } } },
  ]);
  updateSelectFieldOptions(gql, 'F2', [{ id: 'M1', name: 'Audio' }]);
  assert.match(gql.queries[1], /multiSelectOptions/);
  assert.match(gql.queries[1], /id: "M1"/);
});

test('normalizeIterationConfiguration uses required top-level cadence and preserves an existing title', () => {
  const current = { iterations: [{ id: 'I1', title: 'Sprint 7', startDate: '2026-09-14', duration: 14 }] };
  const normalized = normalizeIterationConfiguration(current, {
    iterations: [{ startDate: '2026-09-14', duration: 14 }],
  });
  assert.equal(normalized.startDate, '2026-09-14');
  assert.equal(normalized.duration, 14);
  assert.equal(normalized.iterations[0].title, 'Sprint 7');
});

test('configureIterationField emits current schema shape and verifies the returned configuration', () => {
  const gql = gqlStub([
    { data: { node: { id: 'ITER', name: 'Sprint', configuration: { duration: 14, iterations: [{ id: 'I1', title: 'Sprint 7', startDate: '2026-09-14', duration: 14 }] } } } },
    { data: { updateProjectV2Field: { projectV2Field: { id: 'ITER', name: 'Sprint', configuration: { duration: 14, iterations: [{ id: 'I1', title: 'Sprint 7', startDate: '2026-09-14', duration: 14 }] } } } } },
  ]);
  configureIterationField(gql, 'ITER', { startDate: '2026-09-14', duration: 14, iterations: [{ startDate: '2026-09-14', duration: 14 }] });
  assert.match(gql.queries[1], /iterationConfiguration: \{startDate: "2026-09-14", duration: 14, iterations:/);
});

test('createProjectField supports MULTI_SELECT through createProjectV2Field', () => {
  const gql = gqlStub([
    { data: { organization: { projectV2: { id: 'P1' } } } },
    { data: { createProjectV2Field: { projectV2Field: { __typename: 'ProjectV2MultiSelectField', id: 'F2', name: 'Areas', dataType: 'MULTI_SELECT', options: [] } } } },
  ]);
  const field = createProjectField(gql, () => 'organization', {
    owner: 'EMBLEM-NLP', number: 1, name: 'Areas', dataType: 'MULTI_SELECT', options: ['Audio', 'Lighting'],
  });
  assert.equal(field.id, 'F2');
  assert.match(gql.queries[1], /dataType: MULTI_SELECT/);
  assert.match(gql.queries[1], /multiSelectOptions/);
});

test('createProjectField supports ITERATION with the required current configuration', () => {
  const gql = gqlStub([
    { data: { organization: { projectV2: { id: 'P1' } } } },
    { data: { createProjectV2Field: { projectV2Field: { __typename: 'ProjectV2IterationField', id: 'F3', name: 'Sprint', dataType: 'ITERATION', configuration: { duration: 14, iterations: [] } } } } },
  ]);
  createProjectField(gql, () => 'organization', {
    owner: 'EMBLEM-NLP', number: 1, name: 'Sprint', dataType: 'ITERATION',
    iterationConfiguration: {
      startDate: '2026-09-14', duration: 14,
      iterations: [{ title: 'Sprint 1', startDate: '2026-09-14', duration: 14 }],
    },
  });
  assert.match(gql.queries[1], /iterationConfiguration: \{startDate: "2026-09-14", duration: 14/);
});

test('updateMultiSelectItemField sets multiple option ids and can clear', () => {
  const gql = gqlStub([
    { data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'ITEM' } } } },
    { data: { clearProjectV2ItemFieldValue: { projectV2Item: { id: 'ITEM' } } } },
  ]);
  updateMultiSelectItemField(gql, { projectId: 'P1', itemId: 'ITEM', fieldId: 'F1', optionIds: ['A', 'B'] });
  assert.match(gql.queries[0], /multiSelectOptionIds: \["A", "B"\]/);
  updateMultiSelectItemField(gql, { projectId: 'P1', itemId: 'ITEM', fieldId: 'F1', clear: true });
  assert.match(gql.queries[1], /clearProjectV2ItemFieldValue/);
});
