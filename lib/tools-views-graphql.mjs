import { z } from 'zod';
import { gh, gql } from './gql.mjs';
import { assertConfirmed, makeOwnerRoot } from './helpers.mjs';
import { makeProjectViewApi, VIEW_LAYOUT_TO_GRAPHQL } from './view-api.mjs';
import { assertBrowserUiAvailable } from './runtime-capabilities.mjs';

function text(value) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

function errorText(error) {
  return { isError: true, content: [{ type: 'text', text: error?.message ?? String(error) }] };
}

async function defaultGroupByPreflight(projectUrl) {
  // Fail closed BEFORE importing Playwright (lib/view-groupby-ui.mjs imports it
  // statically) when this runtime cannot possibly use the browser-ui fallback —
  // e.g. any non-win32 container/hosted environment. See lib/runtime-capabilities.mjs.
  assertBrowserUiAvailable();
  const { preflightViewGroupByUi } = await import('./view-groupby-ui.mjs');
  return preflightViewGroupByUi(projectUrl);
}

async function defaultGroupByApply(projectUrl, specs) {
  assertBrowserUiAvailable();
  const { applyViewGroupByUi } = await import('./view-groupby-ui.mjs');
  return applyViewGroupByUi(projectUrl, specs);
}

function sameOrderedIds(actualFields, expectedIds) {
  if (expectedIds === undefined) return true;
  const actual = (actualFields ?? []).map((field) => field.id);
  return JSON.stringify(actual) === JSON.stringify(expectedIds);
}

function verifySpec(view, spec) {
  if (!view) return `missing view "${spec.name}"`;
  const expectedLayout = VIEW_LAYOUT_TO_GRAPHQL[spec.layout ?? 'table'];
  if (view.layout !== expectedLayout) return `${spec.name}: layout ${view.layout} != ${expectedLayout}`;
  if (spec.filter !== undefined && view.filter !== spec.filter) return `${spec.name}: filter mismatch`;
  if (!sameOrderedIds(view.visibleFields, spec.visibleFieldIds)) return `${spec.name}: visible fields mismatch`;
  if (spec.groupBy !== undefined) {
    const actualGroup = view.groupByFields?.[0]?.name ?? null;
    if (actualGroup?.toLowerCase() !== spec.groupBy.toLowerCase()) return `${spec.name}: groupBy ${actualGroup ?? '<none>'} != ${spec.groupBy}`;
  }
  return null;
}

function viewByName(views, name) {
  const wanted = name.toLowerCase();
  return views.find((view) => view.name.toLowerCase() === wanted) ?? null;
}

/** Create handler factory so API paths can be tested without Playwright or GitHub. */
export function makeViewCreateHandler({ api, preflightGroupBy = defaultGroupByPreflight, applyGroupBy = defaultGroupByApply }) {
  return async ({ owner, number, views, reapply, pruneGhostViews }) => {
    try {
      const initial = api.readProject(owner, number);
      const expectedNames = new Set(views.map((view) => view.name.toLowerCase()));
      // Preserve the project's first/default view unless the caller explicitly targets it.
      const ghosts = initial.views.filter((view) => view.number !== 1 && !expectedNames.has(view.name.toLowerCase()));
      const wouldPrune = [];
      const actionByName = new Map();

      for (const spec of views) {
        const existing = viewByName(initial.views, spec.name);
        if (!existing) {
          actionByName.set(spec.name.toLowerCase(), 'create');
          continue;
        }
        const expectedLayout = VIEW_LAYOUT_TO_GRAPHQL[spec.layout ?? 'table'];
        const layoutMismatch = existing.layout !== expectedLayout;
        if (reapply) {
          actionByName.set(spec.name.toLowerCase(), 'reapply');
        } else if (layoutMismatch && pruneGhostViews) {
          actionByName.set(spec.name.toLowerCase(), 'repair-layout');
        } else {
          actionByName.set(spec.name.toLowerCase(), 'skip');
          if (layoutMismatch) {
            wouldPrune.push({ view: spec.name, reason: `layout mismatch (want ${spec.layout ?? 'table'})` });
          }
        }
      }

      if (!pruneGhostViews) {
        wouldPrune.push(...ghosts.map((view) => ({ view: view.name, reason: 'ghost (not in spec)' })));
      }

      const groupBySpecs = views.filter((spec) => {
        const action = actionByName.get(spec.name.toLowerCase());
        return spec.groupBy && ['create', 'reapply', 'repair-layout'].includes(action);
      });
      // Preflight the only UI-only capability before any API write to avoid partial changes.
      if (groupBySpecs.length) await preflightGroupBy(initial.url);

      let ghostsDeleted = 0;
      if (pruneGhostViews) {
        for (const ghost of ghosts) {
          api.deleteView(owner, number, { viewId: ghost.id });
          ghostsDeleted += 1;
        }
      }

      let created = 0;
      let skipped = 0;
      let reapplied = 0;
      const changedViews = [];
      for (const spec of views) {
        const action = actionByName.get(spec.name.toLowerCase());
        if (action === 'skip') {
          skipped += 1;
          continue;
        }

        if (action === 'create') {
          const createdView = api.createView(owner, number, {
            name: spec.name,
            layout: spec.layout ?? 'table',
            filter: spec.filter,
            visibleFieldIds: spec.visibleFieldIds,
          });
          changedViews.push(createdView);
          created += 1;
          continue;
        }

        const updated = api.updateView(owner, number, {
          viewName: spec.name,
          layout: spec.layout ?? 'table',
          ...(spec.filter === undefined ? {} : { filter: spec.filter }),
          ...(spec.visibleFieldIds === undefined ? {} : { visibleFieldIds: spec.visibleFieldIds }),
        });
        changedViews.push(updated);
        reapplied += 1;
      }

      const groupByApplied = groupBySpecs.length ? await applyGroupBy(initial.url, groupBySpecs) : [];
      const finalProject = api.readProject(owner, number);
      const verificationErrors = views
        .map((spec) => verifySpec(viewByName(finalProject.views, spec.name), spec))
        .filter(Boolean);
      if (verificationErrors.length) {
        throw new Error(`View verification failed: ${verificationErrors.join('; ')}`);
      }

      return text({
        created,
        skipped,
        reapplied,
        verified: true,
        ghostsDeleted,
        wouldPrune: pruneGhostViews ? [] : wouldPrune,
        groupByApplied,
        projectUrl: initial.url,
        views: finalProject.views,
        changedViews,
      });
    } catch (error) {
      return errorText(error);
    }
  };
}

/** Edit one view by name; only groupBy uses the browser fallback. */
export function makeViewEditHandler({ api, preflightGroupBy = defaultGroupByPreflight, applyGroupBy = defaultGroupByApply }) {
  return async ({ owner, number, viewName, name, layout, filter, visibleFieldIds, groupBy }) => {
    try {
      const hasApiEdit = [name, layout, filter, visibleFieldIds].some((value) => value !== undefined);
      if (!hasApiEdit && groupBy === undefined) throw new Error('Nothing to edit — pass name/layout/filter/visibleFieldIds/groupBy.');
      const initial = api.readProject(owner, number);
      const current = viewByName(initial.views, viewName);
      if (!current) throw new Error(`Could not find view name "${viewName}" on project #${number}.`);
      if (groupBy !== undefined) await preflightGroupBy(initial.url);

      if (hasApiEdit) {
        api.updateView(owner, number, {
          viewId: current.id,
          ...(name === undefined ? {} : { name }),
          ...(layout === undefined ? {} : { layout }),
          ...(filter === undefined ? {} : { filter }),
          ...(visibleFieldIds === undefined ? {} : { visibleFieldIds }),
        });
      }

      const finalName = name ?? viewName;
      const groupByApplied = groupBy === undefined
        ? []
        : await applyGroupBy(initial.url, [{ name: finalName, groupBy }]);
      const finalProject = api.readProject(owner, number);
      const finalView = viewByName(finalProject.views, finalName);
      if (!finalView) throw new Error(`View "${finalName}" was not found after edit.`);
      const spec = {
        name: finalName,
        layout: layout ?? finalView.layoutName,
        ...(filter === undefined ? {} : { filter }),
        ...(visibleFieldIds === undefined ? {} : { visibleFieldIds }),
        ...(groupBy === undefined ? {} : { groupBy }),
      };
      const verificationError = verifySpec(finalView, spec);
      if (verificationError) throw new Error(`View verification failed: ${verificationError}`);
      return text({ view: finalView, groupByApplied, verified: true });
    } catch (error) {
      return errorText(error);
    }
  };
}

/** Delete handler keeps the existing confirm gate but now uses GraphQL only. */
export function makeViewDeleteHandler({ api }) {
  return async ({ owner, number, viewName, confirm }) => {
    try {
      assertConfirmed(confirm, 'delete view');
      return text(api.deleteView(owner, number, { viewName }));
    } catch (error) {
      return errorText(error);
    }
  };
}

export function registerViewTools(server, dependencies = {}) {
  const ownerRoot = dependencies.ownerRoot ?? makeOwnerRoot(dependencies.gh ?? gh);
  const api = dependencies.api ?? makeProjectViewApi({ gql: dependencies.gql ?? gql, ownerRoot });
  const common = {
    api,
    preflightGroupBy: dependencies.preflightGroupBy ?? defaultGroupByPreflight,
    applyGroupBy: dependencies.applyGroupBy ?? defaultGroupByApply,
  };

  server.tool(
    'gh_project_view_create',
    'Declaratively create or reconcile Project views. Normal create/layout/filter/visible-field CRUD uses GitHub GraphQL. groupBy remains an explicit browser-ui fallback. Existing names are skipped unless reapply=true; pruneGhostViews deletes non-spec views (except the first/default view) and repairs layout mismatches.',
    {
      owner: z.string().describe('Project owner login'),
      number: z.number().describe('Project number'),
      views: z.array(z.object({
        name: z.string(),
        layout: z.enum(['table', 'board', 'roadmap']).optional().describe('Default: table'),
        groupBy: z.string().optional().describe('UI-only fallback: field name used for grouping, e.g. Status'),
        filter: z.string().optional().describe('GitHub Projects filter syntax'),
        visibleFieldIds: z.array(z.string()).optional().describe('Ordered Project field node IDs to show in table/board layout'),
      })).min(1).describe('Declarative view specification'),
      reapply: z.boolean().optional().describe('Re-apply API-backed settings to matching existing views'),
      pruneGhostViews: z.boolean().optional().describe('Destructive: delete non-spec views except the first/default view; also repair layout mismatches'),
    },
    makeViewCreateHandler(common),
  );

  server.tool(
    'gh_project_view_edit',
    'Edit one Project view by name. name/layout/filter/visibleFieldIds are GraphQL-backed. groupBy is the only browser-ui fallback.',
    {
      owner: z.string().describe('Project owner login'),
      number: z.number().describe('Project number'),
      viewName: z.string().describe('Current exact view name'),
      name: z.string().optional().describe('New view name'),
      layout: z.enum(['table', 'board', 'roadmap']).optional(),
      filter: z.string().optional().describe('New filter; use empty string to clear'),
      visibleFieldIds: z.array(z.string()).optional().describe('Ordered visible Project field node IDs'),
      groupBy: z.string().optional().describe('UI-only fallback: Group by field name'),
    },
    makeViewEditHandler(common),
  );

  server.tool(
    'gh_project_view_delete',
    'Delete one Project view by name through deleteProjectV2View and verify it is absent. Destructive — requires confirm:true. No browser is used.',
    {
      owner: z.string().describe('Project owner login'),
      number: z.number().describe('Project number'),
      viewName: z.string().describe('Exact view name to delete'),
      confirm: z.boolean().describe('Must be true to proceed'),
    },
    makeViewDeleteHandler({ api }),
  );
}
