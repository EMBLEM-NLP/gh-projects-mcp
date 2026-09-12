import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectApiCompat } from '../lib/project-api-compat.mjs';

function backendStub(responses = []) {
  const calls = [];
  const backend = {
    kind: 'github-api',
    ownerRoot: () => 'organization',
    projectView: (owner, number) => ({ id: `P-${owner}-${number}`, number }),
    graphql(query, variables) {
      calls.push({ kind: 'graphql', query, variables });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      if (typeof next === 'function') return next({ query, variables });
      return next ?? { data: {} };
    },
    rest(method, path, body) {
      calls.push({ kind: 'rest', method, path, body });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      if (typeof next === 'function') return next({ method, path, body });
      return next ?? {};
    },
  };
  backend.calls = calls;
  return backend;
}

test('project create resolves owner id and calls createProjectV2', () => {
  const backend = backendStub([
    { data: { organization: { id: 'ORG1' } } },
    { data: { createProjectV2: { projectV2: { id: 'P1', number: 1, title: 'Roadmap', public: false } } } },
  ]);
  const compat = new ProjectApiCompat(backend);
  const out = JSON.parse(compat.handle(['project', 'create', '--owner', 'EMBLEM-NLP', '--title', 'Roadmap']).stdout);
  assert.equal(out.id, 'P1');
  assert.equal(backend.calls[1].variables.input.ownerId, 'ORG1');
  assert.equal(backend.calls[1].variables.input.title, 'Roadmap');
  assert.match(backend.calls[1].query, /createProjectV2/);
});

test('project edit maps CLI flags to updateProjectV2 input', () => {
  const backend = backendStub([
    { data: { updateProjectV2: { projectV2: { id: 'P1', number: 1, title: 'New', public: true } } } },
  ]);
  const compat = new ProjectApiCompat(backend);
  compat.handle([
    'project', 'edit', '1', '--owner', 'EMBLEM-NLP', '--title', 'New', '--description', 'Desc', '--visibility', 'PUBLIC',
  ]);
  assert.deepEqual(backend.calls[0].variables.input, {
    projectId: 'P-EMBLEM-NLP-1', title: 'New', shortDescription: 'Desc', public: true,
  });
});

test('project close and reopen use UpdateProjectV2.closed', () => {
  const backend = backendStub([
    { data: { updateProjectV2: { projectV2: { id: 'P1', number: 1, closed: true } } } },
    { data: { updateProjectV2: { projectV2: { id: 'P1', number: 1, closed: false } } } },
  ]);
  const compat = new ProjectApiCompat(backend);
  compat.handle(['project', 'close', '1', '--owner', 'o']);
  compat.handle(['project', 'close', '1', '--owner', 'o', '--undo']);
  assert.equal(backend.calls[0].variables.input.closed, true);
  assert.equal(backend.calls[1].variables.input.closed, false);
});

test('project copy resolves target owner and maps includeDraftIssues', () => {
  const backend = backendStub([
    { data: { organization: { id: 'ORG2' } } },
    { data: { copyProjectV2: { projectV2: { id: 'COPY', number: 3, title: 'Copy' } } } },
  ]);
  const compat = new ProjectApiCompat(backend);
  const out = JSON.parse(compat.handle([
    'project', 'copy', '1', '--source-owner', 'source', '--target-owner', 'target', '--title', 'Copy', '--drafts', '--format', 'json',
  ]).stdout);
  assert.equal(out.id, 'COPY');
  assert.deepEqual(backend.calls[1].variables.input, {
    projectId: 'P-source-1', ownerId: 'ORG2', title: 'Copy', includeDraftIssues: true,
  });
});

test('project field-list returns paginated field configuration objects', () => {
  const backend = backendStub([{
    data: {
      organization: {
        projectV2: {
          fields: {
            nodes: [{ __typename: 'ProjectV2SingleSelectField', id: 'F1', name: 'Status', dataType: 'SINGLE_SELECT', options: [] }],
            pageInfo: { hasNextPage: false, endCursor: null },
            totalCount: 1,
          },
        },
      },
    },
  }]);
  const compat = new ProjectApiCompat(backend);
  const out = JSON.parse(compat.handle(['project', 'field-list', '1', '--owner', 'o', '--format', 'json']).stdout);
  assert.equal(out.totalCount, 1);
  assert.equal(out.fields[0].id, 'F1');
});

test('iteration field creation fails closed pending #57', () => {
  const compat = new ProjectApiCompat(backendStub());
  assert.throws(
    () => compat.handle(['project', 'field-create', '1', '--owner', 'o', '--name', 'Sprint', '--data-type', 'ITERATION']),
    /#57/,
  );
});

test('item add resolves issue URL node id before addProjectV2ItemById', () => {
  const backend = backendStub([
    { node_id: 'ISSUE1' },
    { data: { addProjectV2ItemById: { item: { id: 'ITEM1', type: 'ISSUE', isArchived: false } } } },
  ]);
  const compat = new ProjectApiCompat(backend);
  const out = JSON.parse(compat.handle([
    'project', 'item-add', '1', '--owner', 'o', '--url', 'https://github.com/a/b/issues/7', '--format', 'json',
  ]).stdout);
  assert.equal(out.id, 'ITEM1');
  assert.equal(backend.calls[0].method, 'GET');
  assert.match(backend.calls[0].path, /repos\/a\/b\/issues\/7$/);
  assert.deepEqual(backend.calls[1].variables.input, { projectId: 'P-o-1', contentId: 'ISSUE1' });
});

test('item field clear uses clearProjectV2ItemFieldValue', () => {
  const backend = backendStub([{ data: { clearProjectV2ItemFieldValue: { projectV2Item: { id: 'I1' } } } }]);
  const compat = new ProjectApiCompat(backend);
  compat.handle(['project', 'item-edit', '--id', 'I1', '--project-id', 'P1', '--field-id', 'F1', '--clear']);
  assert.match(backend.calls[0].query, /clearProjectV2ItemFieldValue/);
  assert.deepEqual(backend.calls[0].variables.input, { projectId: 'P1', itemId: 'I1', fieldId: 'F1' });
});

test('draft item edit maps to updateProjectV2DraftIssue', () => {
  const backend = backendStub([{ data: { updateProjectV2DraftIssue: { draftIssue: { id: 'DI1', title: 'New', body: 'Body' } } } }]);
  const compat = new ProjectApiCompat(backend);
  const out = JSON.parse(compat.handle(['project', 'item-edit', '--id', 'DI1', '--title', 'New', '--body', 'Body', '--format', 'json']).stdout);
  assert.equal(out.id, 'DI1');
  assert.deepEqual(backend.calls[0].variables.input, { draftIssueId: 'DI1', title: 'New', body: 'Body' });
});

test('item list forwards Projects query and normalizes fieldValues nodes', () => {
  const backend = backendStub([{
    data: {
      organization: {
        projectV2: {
          items: {
            nodes: [{ id: 'ITEM1', type: 'ISSUE', isArchived: false, fieldValues: { nodes: [{ __typename: 'ProjectV2ItemFieldTextValue', text: 'x' }] } }],
            pageInfo: { hasNextPage: false, endCursor: null },
            totalCount: 1,
          },
        },
      },
    },
  }]);
  const compat = new ProjectApiCompat(backend);
  const out = JSON.parse(compat.handle(['project', 'item-list', '1', '--owner', 'o', '--limit', '50', '--query', 'status:Todo', '--format', 'json']).stdout);
  assert.equal(out.items[0].fieldValues[0].text, 'x');
  assert.equal(backend.calls[0].variables.query, 'status:Todo');
});
