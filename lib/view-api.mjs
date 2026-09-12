import { gqlStr } from './helpers.mjs';

export const VIEW_LAYOUT_TO_GRAPHQL = {
  table: 'TABLE_LAYOUT',
  board: 'BOARD_LAYOUT',
  roadmap: 'ROADMAP_LAYOUT',
};

export const VIEW_LAYOUT_FROM_GRAPHQL = Object.fromEntries(
  Object.entries(VIEW_LAYOUT_TO_GRAPHQL).map(([key, value]) => [value, key]),
);

const FIELD_NODE_SELECTION = `
  __typename
  ... on ProjectV2FieldCommon { id name dataType }
`;

export const VIEW_SELECTION = `
  id name number layout filter createdAt updatedAt
  configuration {
    visibleFields(first: 100) { nodes { ${FIELD_NODE_SELECTION} } }
  }
  groupByFields(first: 10) { nodes { ${FIELD_NODE_SELECTION} } }
  verticalGroupByFields(first: 10) { nodes { ${FIELD_NODE_SELECTION} } }
`;

function configurationLiteral(visibleFieldIds) {
  if (visibleFieldIds === undefined) return null;
  const ids = visibleFieldIds.map((id) => `"${gqlStr(id)}"`).join(', ');
  return `{visibleFieldIds: [${ids}]}`;
}

function normalizeFieldNodes(connection) {
  return (connection?.nodes ?? []).filter((node) => node?.id).map((node) => ({
    id: node.id,
    name: node.name,
    dataType: node.dataType,
    type: node.__typename,
  }));
}

export function normalizeView(view) {
  if (!view) return null;
  return {
    id: view.id,
    name: view.name,
    number: view.number,
    layout: view.layout,
    layoutName: VIEW_LAYOUT_FROM_GRAPHQL[view.layout] ?? view.layout,
    filter: view.filter ?? '',
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    visibleFields: normalizeFieldNodes(view.configuration?.visibleFields),
    groupByFields: normalizeFieldNodes(view.groupByFields),
    verticalGroupByFields: normalizeFieldNodes(view.verticalGroupByFields),
  };
}

/** Build a GraphQL-backed Project view client using injected gql/ownerRoot dependencies. */
export function makeProjectViewApi({ gql, ownerRoot }) {
  function readProject(owner, number) {
    const root = ownerRoot(owner);
    const query = `{ ${root}(login: "${gqlStr(owner)}") {
      projectV2(number: ${Number(number)}) {
        id url
        views(first: 100) { nodes { ${VIEW_SELECTION} } }
      }
    } }`;
    const project = gql(query).data?.[root]?.projectV2;
    if (!project?.id) throw new Error(`Could not resolve project #${number} for ${owner}.`);
    return {
      id: project.id,
      url: project.url,
      views: (project.views?.nodes ?? []).map(normalizeView),
    };
  }

  function findView(owner, number, { viewId, viewName } = {}) {
    const project = readProject(owner, number);
    let view = null;
    if (viewId) view = project.views.find((candidate) => candidate.id === viewId) ?? null;
    if (!view && viewName) {
      const wanted = viewName.toLowerCase();
      view = project.views.find((candidate) => candidate.name.toLowerCase() === wanted) ?? null;
    }
    if (!view) {
      const descriptor = viewId ? `id ${viewId}` : `name "${viewName}"`;
      throw new Error(`Could not find view ${descriptor} on project #${number}.`);
    }
    return { project, view };
  }

  function createView(owner, number, { name, layout = 'table', filter, visibleFieldIds } = {}) {
    const project = readProject(owner, number);
    const graphLayout = VIEW_LAYOUT_TO_GRAPHQL[layout];
    if (!graphLayout) throw new Error(`Unsupported view layout: ${layout}.`);
    const config = configurationLiteral(visibleFieldIds);
    const inputParts = [
      `projectId: "${gqlStr(project.id)}"`,
      `name: "${gqlStr(name)}"`,
      `layout: ${graphLayout}`,
    ];
    if (config) inputParts.push(`configuration: ${config}`);
    const mutation = `mutation { createProjectV2View(input: {${inputParts.join(', ')}}) {
      projectV2View { ${VIEW_SELECTION} }
    } }`;
    let view = normalizeView(gql(mutation).data?.createProjectV2View?.projectV2View);
    if (!view?.id) throw new Error('createProjectV2View returned no view.');

    // CreateProjectV2ViewInput currently has no filter field; apply it immediately via update.
    if (filter !== undefined) {
      view = updateView(owner, number, { viewId: view.id, filter });
    }

    const verified = findView(owner, number, { viewId: view.id }).view;
    if (verified.name !== name || verified.layout !== graphLayout || (filter !== undefined && verified.filter !== filter)) {
      throw new Error(`View verification failed after creating "${name}".`);
    }
    if (visibleFieldIds !== undefined) {
      const actual = verified.visibleFields.map((field) => field.id);
      if (JSON.stringify(actual) !== JSON.stringify(visibleFieldIds)) {
        throw new Error(`Visible-field verification failed after creating "${name}".`);
      }
    }
    return verified;
  }

  function updateView(owner, number, { viewId, viewName, name, layout, filter, visibleFieldIds } = {}) {
    const { view: current } = findView(owner, number, { viewId, viewName });
    const parts = [`viewId: "${gqlStr(current.id)}"`];
    if (name !== undefined) parts.push(`name: "${gqlStr(name)}"`);
    if (layout !== undefined) {
      const graphLayout = VIEW_LAYOUT_TO_GRAPHQL[layout];
      if (!graphLayout) throw new Error(`Unsupported view layout: ${layout}.`);
      parts.push(`layout: ${graphLayout}`);
    }
    if (filter !== undefined) parts.push(`filter: "${gqlStr(filter)}"`);
    const config = configurationLiteral(visibleFieldIds);
    if (config) parts.push(`configuration: ${config}`);
    if (parts.length === 1) throw new Error('Nothing to edit — pass name/layout/filter/visibleFieldIds.');

    const mutation = `mutation { updateProjectV2View(input: {${parts.join(', ')}}) {
      projectV2View { ${VIEW_SELECTION} }
    } }`;
    const returned = normalizeView(gql(mutation).data?.updateProjectV2View?.projectV2View);
    if (!returned?.id) throw new Error('updateProjectV2View returned no view.');

    const verified = findView(owner, number, { viewId: current.id }).view;
    if (name !== undefined && verified.name !== name) throw new Error('View-name verification failed after update.');
    if (layout !== undefined && verified.layout !== VIEW_LAYOUT_TO_GRAPHQL[layout]) throw new Error('View-layout verification failed after update.');
    if (filter !== undefined && verified.filter !== filter) throw new Error('View-filter verification failed after update.');
    if (visibleFieldIds !== undefined) {
      const actual = verified.visibleFields.map((field) => field.id);
      if (JSON.stringify(actual) !== JSON.stringify(visibleFieldIds)) throw new Error('Visible-field verification failed after update.');
    }
    return verified;
  }

  function deleteView(owner, number, { viewId, viewName } = {}) {
    const { view } = findView(owner, number, { viewId, viewName });
    const mutation = `mutation { deleteProjectV2View(input: {viewId: "${gqlStr(view.id)}"}) {
      projectV2View { id name }
    } }`;
    const deleted = gql(mutation).data?.deleteProjectV2View?.projectV2View;
    if (!deleted?.id) throw new Error('deleteProjectV2View returned no deleted view.');
    const remaining = readProject(owner, number).views.some((candidate) => candidate.id === view.id);
    if (remaining) throw new Error(`View "${view.name}" still exists after deleteProjectV2View.`);
    return { id: view.id, name: view.name, deleted: true };
  }

  return { readProject, findView, createView, updateView, deleteView };
}
