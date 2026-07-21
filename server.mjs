#!/usr/bin/env node
/**
 * gh-projects-mcp — MCP server for managing GitHub Projects v2.
 *
 * Thin wrappers over `gh project` / `gh issue` / `gh label` and the GraphQL
 * API, plus Playwright/CDP-driven view management (GitHub's API has no
 * createProjectV2View mutation — view creation is web-UI only).
 *
 * Every tool takes owner/repo/project-number as explicit parameters —
 * nothing is hardcoded to one project, so this works the same from any
 * repo or chat.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gh, gql } from './lib/gql.mjs';
import { registerViewTools } from './lib/tools-views.mjs';

const server = new McpServer({ name: 'gh-projects-mcp', version: '1.0.0' });

function text(t) {
  return { content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] };
}

function errorText(err) {
  return { isError: true, content: [{ type: 'text', text: err.message ?? String(err) }] };
}

async function safe(fn) {
  try { return await fn(); } catch (err) { return errorText(err); }
}

// Resolve whether an owner is a user or an organization, so GraphQL queries pick
// the correct root field. GitHub's /users/{login} endpoint answers for both and
// returns type "User" | "Organization". Cached per process.
const _ownerRootCache = new Map();
function ownerRoot(owner) {
  if (_ownerRootCache.has(owner)) return _ownerRootCache.get(owner);
  let root = 'user';
  try {
    const r = gh('api', `users/${owner}`, '--jq', '.type');
    if (r.stdout.trim() === 'Organization') root = 'organization';
  } catch { /* default to user on any lookup failure */ }
  _ownerRootCache.set(owner, root);
  return root;
}

// Escape a string for safe inline insertion into a GraphQL query literal.
function gqlStr(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }

// ── Auth ─────────────────────────────────────────────────────────────────────

server.tool(
  'gh_auth_status',
  "Check the authenticated gh CLI account and whether it has the 'project' scope required for all other tools in this server.",
  {},
  async () => safe(() => {
    const r = gh('auth', 'status');
    return text(r.stdout || r.stderr);
  }),
);

// ── Projects ─────────────────────────────────────────────────────────────────

server.tool(
  'gh_project_list',
  'List GitHub Projects (v2) owned by a user or organization.',
  { owner: z.string().describe('GitHub username or org login, e.g. "thisis-romar"') },
  async ({ owner }) => safe(() => {
    const r = gh('project', 'list', '--owner', owner, '--format', 'json');
    return text(JSON.parse(r.stdout));
  }),
);

server.tool(
  'gh_project_view',
  'Get full details of one GitHub Project: title, description, visibility, item count, fields, and views (including view layout/createdAt, which the plain gh CLI does not surface).',
  {
    owner: z.string().describe('GitHub username or org login'),
    number: z.number().describe('Project number, e.g. 5'),
  },
  async ({ owner, number }) => safe(() => {
    const r = gh('project', 'view', String(number), '--owner', owner, '--format', 'json');
    const project = JSON.parse(r.stdout);
    let views = [];
    try {
      const root = ownerRoot(owner);
      const q = `{ ${root}(login: "${gqlStr(owner)}") { projectV2(number: ${number}) { createdAt updatedAt views(first: 20) { nodes { name number createdAt layout } } } } }`;
      const vr = gql(q);
      views = vr.data[root]?.projectV2?.views?.nodes ?? [];
    } catch { /* view query unavailable — omit views */ }
    return text({ ...project, views });
  }),
);

server.tool(
  'gh_project_create',
  'Create a new GitHub Project (v2) board for a user or org.',
  {
    owner: z.string().describe('GitHub username or org login to own the project'),
    title: z.string().describe('Project title'),
  },
  async ({ owner, title }) => safe(() => {
    const r = gh('project', 'create', '--owner', owner, '--title', title, '--format', 'json');
    return text(JSON.parse(r.stdout));
  }),
);

server.tool(
  'gh_project_edit',
  'Edit a project\'s metadata: title, description (shortDescription), README body, visibility, and open/closed state. Pass only the fields you want to change. Maps to `gh project edit` (title/description/readme/visibility) and `gh project close`/`--undo` (closed).',
  {
    owner: z.string().describe('Project owner login'),
    number: z.number().describe('Project number'),
    title: z.string().optional().describe('New title'),
    description: z.string().optional().describe('New short description'),
    readme: z.string().optional().describe('New README body (markdown)'),
    visibility: z.enum(['PUBLIC', 'PRIVATE']).optional().describe('Project visibility'),
    closed: z.boolean().optional().describe('true = close the project, false = reopen it'),
  },
  async ({ owner, number, title, description, readme, visibility, closed }) => safe(() => {
    const changed = [];
    const editArgs = ['project', 'edit', String(number), '--owner', owner];
    if (title !== undefined) { editArgs.push('--title', title); changed.push('title'); }
    if (description !== undefined) { editArgs.push('--description', description); changed.push('description'); }
    if (readme !== undefined) { editArgs.push('--readme', readme); changed.push('readme'); }
    if (visibility !== undefined) { editArgs.push('--visibility', visibility); changed.push('visibility'); }
    if (changed.length) gh(...editArgs);
    if (closed !== undefined) {
      const closeArgs = ['project', 'close', String(number), '--owner', owner];
      if (!closed) closeArgs.push('--undo');
      gh(...closeArgs);
      changed.push(closed ? 'closed' : 'reopened');
    }
    if (!changed.length) throw new Error('Nothing to edit — pass at least one of title/description/readme/visibility/closed.');
    return text(`Updated: ${changed.join(', ')}.`);
  }),
);

server.tool(
  'gh_project_delete',
  'Permanently DELETE a project board and all its items. Irreversible — requires confirm:true.',
  {
    owner: z.string().describe('Project owner login'),
    number: z.number().describe('Project number'),
    confirm: z.boolean().describe('Must be true to proceed — cannot be undone'),
  },
  async ({ owner, number, confirm }) => safe(() => {
    if (!confirm) throw new Error('Refusing to delete project without confirm:true.');
    gh('project', 'delete', String(number), '--owner', owner);
    return text(`Deleted project #${number}.`);
  }),
);

server.tool(
  'gh_project_copy',
  'Copy a project to a new one (fields/views copied; items only with drafts:true).',
  {
    sourceOwner: z.string().describe('Owner of the source project'),
    number: z.number().describe('Source project number'),
    targetOwner: z.string().describe('Owner for the new copy'),
    title: z.string().describe('Title for the new project'),
    drafts: z.boolean().optional().describe('Include draft issues'),
  },
  async ({ sourceOwner, number, targetOwner, title, drafts }) => safe(() => {
    const args = ['project', 'copy', String(number), '--source-owner', sourceOwner, '--target-owner', targetOwner, '--title', title, '--format', 'json'];
    if (drafts) args.push('--drafts');
    const r = gh(...args);
    return text(JSON.parse(r.stdout));
  }),
);

server.tool(
  'gh_project_unlink',
  'Unlink a project from a repository or team (mirror of gh_project_link).',
  {
    owner: z.string().describe('Project owner login'),
    number: z.number().describe('Project number'),
    repo: z.string().optional().describe('Repository to unlink, as "owner/repo"'),
    team: z.string().optional().describe('Team to unlink, as "org/team-slug"'),
  },
  async ({ owner, number, repo, team }) => safe(() => {
    if (!repo && !team) throw new Error('Pass repo or team to unlink.');
    const args = ['project', 'unlink', String(number), '--owner', owner];
    if (repo) args.push('--repo', repo);
    if (team) args.push('--team', team);
    gh(...args);
    return text('Unlinked.');
  }),
);

server.tool(
  'gh_project_mark_template',
  'Mark (or, with undo:true, unmark) an ORG-owned project as a template. User-owned projects cannot be templates.',
  {
    owner: z.string().describe('Org owner login'),
    number: z.number().describe('Project number'),
    undo: z.boolean().optional().describe('Unmark instead of mark'),
  },
  async ({ owner, number, undo }) => safe(() => {
    const args = ['project', 'mark-template', String(number), '--owner', owner];
    if (undo) args.push('--undo');
    gh(...args);
    return text(undo ? 'Unmarked as template.' : 'Marked as template.');
  }),
);

server.tool(
  'gh_project_link',
  'Link a GitHub Project to a repository (or team), so items in that repo can be auto-added and the project shows up on the repo page.',
  {
    number: z.number().describe('Project number'),
    owner: z.string().describe('Project owner login'),
    repo: z.string().describe('Repository to link, as "owner/repo"'),
  },
  async ({ number, owner, repo }) => safe(() => {
    const r = gh('project', 'link', String(number), '--owner', owner, '--repo', repo);
    return text(r.stdout || 'Linked.');
  }),
);

// ── Fields ───────────────────────────────────────────────────────────────────

server.tool(
  'gh_project_field_list',
  'List all fields on a project (built-in like Status/Assignees plus custom fields), with their IDs and option IDs for single-select fields. Always call this before gh_project_field_create or gh_project_item_edit to get current IDs — never hardcode them.',
  {
    owner: z.string().describe('Project owner login'),
    number: z.number().describe('Project number'),
  },
  async ({ owner, number }) => safe(() => {
    const r = gh('project', 'field-list', String(number), '--owner', owner, '--format', 'json');
    const parsed = JSON.parse(r.stdout);
    return text(parsed.fields ?? parsed);
  }),
);

server.tool(
  'gh_project_field_create',
  'Create a custom field on a project. NOTE: Projects v2 ships reserved built-in fields (Status, Title, Assignees, Labels, Milestone, Repository, ...) — creating a field with one of those exact names throws a GraphQL error. Call gh_project_field_list first and reuse the existing field ID instead of creating a duplicate.',
  {
    owner: z.string().describe('Project owner login'),
    number: z.number().describe('Project number'),
    name: z.string().describe('Field name'),
    dataType: z.enum(['TEXT', 'NUMBER', 'DATE', 'SINGLE_SELECT', 'ITERATION']).describe('Field data type'),
    options: z.array(z.string()).optional().describe('Option labels — required when dataType is SINGLE_SELECT'),
  },
  async ({ owner, number, name, dataType, options }) => safe(() => {
    const args = ['project', 'field-create', String(number), '--owner', owner, '--name', name, '--data-type', dataType, '--format', 'json'];
    if (dataType === 'SINGLE_SELECT') {
      if (!options?.length) throw new Error('options is required when dataType is SINGLE_SELECT');
      args.push('--single-select-options', options.join(','));
    }
    const r = gh(...args);
    return text(JSON.parse(r.stdout));
  }),
);

server.tool(
  'gh_project_field_option_update',
  'Update the options of an existing SINGLE_SELECT field (add / rename / recolor). WARNING: the underlying updateProjectV2Field mutation REPLACES the entire option set — options you omit are deleted (along with their item assignments). This tool guards against that: it fetches the current options and, unless allowRemove=true, errors if your list drops any existing option name. Pass the FULL desired option set.',
  {
    fieldId: z.string().describe('SINGLE_SELECT field node ID (from gh_project_field_list)'),
    options: z.array(z.object({
      name: z.string(),
      color: z.enum(['GRAY', 'BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'RED', 'PINK', 'PURPLE']).optional().describe('Default GRAY'),
      description: z.string().optional(),
    })).min(1).describe('The COMPLETE desired option list (include existing options you want to keep)'),
    allowRemove: z.boolean().optional().describe('Permit dropping existing options (deletes them + their assignments). Default false.'),
  },
  async ({ fieldId, options, allowRemove }) => safe(() => {
    // Fetch current option names to guard against accidental deletion.
    const cur = gql(`{ node(id: "${gqlStr(fieldId)}") { ... on ProjectV2SingleSelectField { name options { name } } } }`);
    const node = cur.data.node;
    if (!node) throw new Error('fieldId did not resolve to a ProjectV2SingleSelectField.');
    const currentNames = (node.options ?? []).map((o) => o.name);
    const desiredNames = options.map((o) => o.name);
    const removed = currentNames.filter((n) => !desiredNames.includes(n));
    if (removed.length && !allowRemove) {
      throw new Error(`This would DELETE options not in your list: ${removed.join(', ')}. Include them, or pass allowRemove:true to confirm deletion.`);
    }
    const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const optsLiteral = options.map((o) =>
      `{name: "${esc(o.name)}", color: ${o.color ?? 'GRAY'}, description: "${esc(o.description ?? '')}"}`
    ).join(', ');
    const q = `mutation { updateProjectV2Field(input: {fieldId: "${fieldId}", singleSelectOptions: [${optsLiteral}]}) { projectV2Field { ... on ProjectV2SingleSelectField { options { id name } } } } }`;
    const r = gql(q);
    return text(r.data.updateProjectV2Field.projectV2Field);
  }),
);

server.tool(
  'gh_project_iteration_configure',
  'Configure an ITERATION (sprint) field: set its iteration cadence and iterations. Like option editing, updateProjectV2Field replaces the iteration configuration — pass the full set of iterations you want. Each iteration is defined by a startDate (YYYY-MM-DD) and a duration in days.',
  {
    fieldId: z.string().describe('ITERATION field node ID (from gh_project_field_list)'),
    iterations: z.array(z.object({
      startDate: z.string().describe('ISO date YYYY-MM-DD'),
      duration: z.number().describe('Length in days'),
      title: z.string().optional(),
    })).min(1).describe('The iterations to configure'),
  },
  async ({ fieldId, iterations }) => safe(() => {
    const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const iterLiteral = iterations.map((it) => {
      const parts = [`startDate: "${esc(it.startDate)}"`, `duration: ${it.duration}`];
      if (it.title) parts.push(`title: "${esc(it.title)}"`);
      return `{${parts.join(', ')}}`;
    }).join(', ');
    const q = `mutation { updateProjectV2Field(input: {fieldId: "${fieldId}", iterationConfiguration: {iterations: [${iterLiteral}]}}) { projectV2Field { ... on ProjectV2IterationField { configuration { iterations { title startDate duration } } } } } }`;
    const r = gql(q);
    return text(r.data.updateProjectV2Field.projectV2Field);
  }),
);

server.tool(
  'gh_project_field_delete',
  'Permanently DELETE a custom field and its values on all items. Destructive — requires confirm:true. Built-in fields cannot be deleted.',
  {
    fieldId: z.string().describe('Field node ID (from gh_project_field_list)'),
    confirm: z.boolean().describe('Must be true to proceed'),
  },
  async ({ fieldId, confirm }) => safe(() => {
    if (!confirm) throw new Error('Refusing to delete field without confirm:true.');
    gh('project', 'field-delete', '--id', fieldId);
    return text('Field deleted.');
  }),
);

// ── Items ────────────────────────────────────────────────────────────────────

server.tool(
  'gh_project_item_list',
  'List items (issues, PRs, draft issues) on a project board, with their current field values.',
  {
    owner: z.string().describe('Project owner login'),
    number: z.number().describe('Project number'),
    limit: z.number().optional().describe('Max items to return (default 200)'),
    query: z.string().optional().describe('Projects filter syntax, e.g. "assignee:octocat -status:Done"'),
  },
  async ({ owner, number, limit, query }) => safe(() => {
    const args = ['project', 'item-list', String(number), '--owner', owner, '--format', 'json', '--limit', String(limit ?? 200)];
    if (query) args.push('--query', query);
    const r = gh(...args);
    const parsed = JSON.parse(r.stdout);
    return text(parsed.items ?? parsed);
  }),
);

server.tool(
  'gh_project_item_add',
  'Add an existing issue or pull request to a project board by URL.',
  {
    owner: z.string().describe('Project owner login'),
    number: z.number().describe('Project number'),
    url: z.string().describe('Full URL of the issue or PR to add'),
  },
  async ({ owner, number, url }) => safe(() => {
    const r = gh('project', 'item-add', String(number), '--owner', owner, '--url', url, '--format', 'json');
    return text(JSON.parse(r.stdout));
  }),
);

server.tool(
  'gh_project_item_create',
  'Create a draft-issue item directly on a project board (no repo issue). Draft issues live only on the board until converted with gh_project_draft_convert. Returns the created item (with its id).',
  {
    owner: z.string().describe('Project owner login'),
    number: z.number().describe('Project number'),
    title: z.string().describe('Draft issue title'),
    body: z.string().optional().describe('Draft issue body (markdown)'),
  },
  async ({ owner, number, title, body }) => safe(() => {
    const args = ['project', 'item-create', String(number), '--owner', owner, '--title', title, '--format', 'json'];
    if (body !== undefined) args.push('--body', body);
    const r = gh(...args);
    return text(JSON.parse(r.stdout));
  }),
);

server.tool(
  'gh_project_draft_edit',
  'Edit a draft issue item\'s title and/or body (updateProjectV2DraftIssue). Accepts the project ITEM id (PVTI_…, from gh_project_item_create/list) and resolves the draft-content id (DI_…) that gh requires; a DI_ id is also accepted directly. For draft items only; use gh_project_item_edit for field values.',
  {
    itemId: z.string().describe('Draft item node ID (PVTI_…) or draft-content id (DI_…)'),
    title: z.string().optional().describe('New title'),
    body: z.string().optional().describe('New body (markdown)'),
  },
  async ({ itemId, title, body }) => safe(() => {
    if (title === undefined && body === undefined) throw new Error('Pass at least one of title/body.');
    // gh project item-edit --id expects the draft CONTENT id (DI_…), not the item id (PVTI_…).
    let draftId = itemId;
    if (!itemId.startsWith('DI_')) {
      const q = `{ node(id: "${gqlStr(itemId)}") { ... on ProjectV2Item { content { __typename ... on DraftIssue { id } } } } }`;
      const contentId = gql(q).data.node?.content?.id;
      if (!contentId) throw new Error('Could not resolve a draft-content id from that item id — is it a draft issue item?');
      draftId = contentId;
    }
    const args = ['project', 'item-edit', '--id', draftId, '--format', 'json'];
    if (title !== undefined) args.push('--title', title);
    if (body !== undefined) args.push('--body', body);
    const r = gh(...args);
    return text(r.stdout || 'Draft updated.');
  }),
);

server.tool(
  'gh_project_draft_convert',
  'Convert a draft-issue item into a real repository issue (convertProjectV2DraftIssueItemToIssue). The item keeps its board field values.',
  {
    itemId: z.string().describe('Draft item node ID'),
    repoOwner: z.string().describe('Owner of the repo to create the issue in'),
    repo: z.string().describe('Repo name (without owner) to create the issue in'),
  },
  async ({ itemId, repoOwner, repo }) => safe(() => {
    const repoId = gh('api', `repos/${repoOwner}/${repo}`, '--jq', '.node_id').stdout.trim();
    const q = `mutation { convertProjectV2DraftIssueItemToIssue(input: {itemId: "${itemId}", repositoryId: "${repoId}"}) { item { id content { ... on Issue { number url } } } } }`;
    const r = gql(q);
    return text(r.data.convertProjectV2DraftIssueItemToIssue.item);
  }),
);

server.tool(
  'gh_project_item_edit',
  'Set (or clear) one field value on a project item. Get projectId from gh_project_view/gh_project_create, itemId from gh_project_item_list/gh_project_item_add, and fieldId/optionId from gh_project_field_list.',
  {
    projectId: z.string().describe('Project node ID (e.g. "PVT_kwHODNwyZM4B...")'),
    itemId: z.string().describe('Project item node ID'),
    fieldId: z.string().describe('Field node ID'),
    valueType: z.enum(['text', 'number', 'date', 'single_select', 'iteration']).describe('Which kind of value this field holds'),
    value: z.string().optional().describe('The value to set: raw text, a number as string, an ISO date (YYYY-MM-DD), a single-select option ID, or an iteration ID. Omit (with clear=true) to clear the field.'),
    clear: z.boolean().optional().describe('Clear the field instead of setting a value'),
  },
  async ({ projectId, itemId, fieldId, valueType, value, clear }) => safe(() => {
    const args = ['project', 'item-edit', '--id', itemId, '--project-id', projectId, '--field-id', fieldId];
    if (clear) {
      args.push('--clear');
    } else {
      if (value === undefined) throw new Error('value is required unless clear=true');
      const flag = { text: '--text', number: '--number', date: '--date', single_select: '--single-select-option-id', iteration: '--iteration-id' }[valueType];
      args.push(flag, value);
    }
    gh(...args);
    return text('Field updated.');
  }),
);

server.tool(
  'gh_project_item_archive',
  'Archive (or unarchive) an item on a project board without deleting the underlying issue/PR.',
  {
    owner: z.string().describe('Project owner login'),
    number: z.number().describe('Project number'),
    itemId: z.string().describe('Project item node ID'),
    undo: z.boolean().optional().describe('Unarchive instead of archive'),
  },
  async ({ owner, number, itemId, undo }) => safe(() => {
    const args = ['project', 'item-archive', String(number), '--owner', owner, '--id', itemId];
    if (undo) args.push('--undo');
    gh(...args);
    return text(undo ? 'Unarchived.' : 'Archived.');
  }),
);

server.tool(
  'gh_project_item_delete',
  'Remove an item from a project board permanently (distinct from archive). Does NOT delete the underlying issue/PR. Destructive — requires confirm:true.',
  {
    owner: z.string().describe('Project owner login'),
    number: z.number().describe('Project number'),
    itemId: z.string().describe('Project item node ID'),
    confirm: z.boolean().describe('Must be true to proceed'),
  },
  async ({ owner, number, itemId, confirm }) => safe(() => {
    if (!confirm) throw new Error('Refusing to delete item without confirm:true.');
    gh('project', 'item-delete', String(number), '--owner', owner, '--id', itemId);
    return text('Item removed from board.');
  }),
);

server.tool(
  'gh_project_item_move',
  'Reorder an item on the board. Places it after afterItemId, or at the top if omitted (updateProjectV2ItemPosition).',
  {
    projectId: z.string().describe('Project node ID'),
    itemId: z.string().describe('Item node ID to move'),
    afterItemId: z.string().optional().describe('Place the item after this item; omit to move to the top'),
  },
  async ({ projectId, itemId, afterItemId }) => safe(() => {
    const decls = ['$p:ID!', '$i:ID!']; const inputs = ['projectId:$p', 'itemId:$i']; const args = ['-f', `p=${projectId}`, '-f', `i=${itemId}`];
    if (afterItemId) { decls.push('$a:ID'); inputs.push('afterId:$a'); args.push('-f', `a=${afterItemId}`); }
    const q = `mutation(${decls.join(',')}){updateProjectV2ItemPosition(input:{${inputs.join(',')}}){items(first:1){nodes{id}}}}`;
    gql(q, ...args);
    return text('Item moved.');
  }),
);

// ── Views (read-only — creation/layout requires Playwright, see tools-views.mjs) ──

server.tool(
  'gh_project_views_list',
  'List a project\'s views (name, number, layout, createdAt) via GraphQL. Read-only — GitHub\'s API has no mutation for creating or changing view layout; use gh_project_view_create for that.',
  {
    owner: z.string().describe('Project owner login'),
    number: z.number().describe('Project number'),
  },
  async ({ owner, number }) => safe(() => {
    const root = ownerRoot(owner);
    const q = `{ ${root}(login: "${gqlStr(owner)}") { projectV2(number: ${number}) { views(first: 30) { nodes { name number createdAt layout } } } } }`;
    const r = gql(q);
    return text(r.data[root]?.projectV2?.views?.nodes ?? []);
  }),
);

// ── Issues & labels ──────────────────────────────────────────────────────────

server.tool(
  'gh_issue_create',
  'Create an issue in a repo. Body is written via a temp file to avoid shell-escaping issues with newlines/quotes.',
  {
    owner: z.string().describe('Repo owner login'),
    repo: z.string().describe('Repo name (without owner)'),
    title: z.string().describe('Issue title'),
    body: z.string().optional().describe('Issue body (markdown)'),
    labels: z.array(z.string()).optional().describe('Labels to apply (must already exist — use gh_label_ensure first)'),
    milestone: z.string().optional().describe('Milestone title (not number) to assign'),
  },
  async ({ owner, repo, title, body, labels, milestone }) => safe(() => {
    const tmpFile = join(tmpdir(), `gh-issue-body-${Date.now()}.md`);
    writeFileSync(tmpFile, body ?? '', 'utf8');
    try {
      const args = ['issue', 'create', '--repo', `${owner}/${repo}`, '--title', title, '--body-file', tmpFile];
      for (const l of labels ?? []) args.push('--label', l);
      if (milestone) args.push('--milestone', milestone);
      const r = gh(...args);
      return text({ url: r.stdout });
    } finally {
      try { unlinkSync(tmpFile); } catch { /* best effort */ }
    }
  }),
);

server.tool(
  'gh_issue_list',
  'List issues in a repo, including each issue\'s GraphQL node id (needed by gh_subissue_link).',
  {
    owner: z.string().describe('Repo owner login'),
    repo: z.string().describe('Repo name (without owner)'),
    state: z.enum(['open', 'closed', 'all']).optional().describe('Filter by state (default: open)'),
    limit: z.number().optional().describe('Max issues to return (default 200)'),
  },
  async ({ owner, repo, state, limit }) => safe(() => {
    const r = gh('issue', 'list', '--repo', `${owner}/${repo}`, '--state', state ?? 'open', '--limit', String(limit ?? 200), '--json', 'id,number,title,url,state,labels');
    return text(JSON.parse(r.stdout));
  }),
);

server.tool(
  'gh_label_ensure',
  'Create a label in a repo if it does not already exist (idempotent — safe to call every time before using a label).',
  {
    owner: z.string().describe('Repo owner login'),
    repo: z.string().describe('Repo name (without owner)'),
    name: z.string().describe('Label name'),
    color: z.string().describe('Hex color, no leading #, e.g. "84b6eb"'),
    description: z.string().optional(),
  },
  async ({ owner, repo, name, color, description }) => safe(() => {
    const existingRaw = gh('label', 'list', '--repo', `${owner}/${repo}`, '--json', 'name');
    const existing = new Set(JSON.parse(existingRaw.stdout).map((l) => l.name));
    if (existing.has(name)) return text(`Label "${name}" already exists — skipped.`);
    const args = ['label', 'create', name, '--repo', `${owner}/${repo}`, '--color', color];
    if (description) args.push('--description', description);
    gh(...args);
    return text(`Created label "${name}".`);
  }),
);

// ── Sub-issues & status updates (GraphQL — no gh CLI subcommand exists) ───────

server.tool(
  'gh_subissue_link',
  'Link an issue as a sub-issue of a parent (epic) issue. Both IDs must be GraphQL node IDs (not issue numbers) — get them from the `id` field returned by gh_issue_list.',
  {
    parentNodeId: z.string().describe('Parent (epic) issue GraphQL node ID'),
    childNodeId: z.string().describe('Child issue GraphQL node ID to attach as a sub-issue'),
  },
  async ({ parentNodeId, childNodeId }) => safe(() => {
    const q = `mutation($p:ID!,$c:ID!){addSubIssue(input:{issueId:$p,subIssueId:$c}){issue{number}subIssue{number}}}`;
    const r = gql(q, '-f', `p=${parentNodeId}`, '-f', `c=${childNodeId}`);
    return text(r.data);
  }),
);

server.tool(
  'gh_status_update_create',
  'Post a status update on a project (the "Add status update" feature on the project overview page). Requires project write scope.',
  {
    projectId: z.string().describe('Project node ID'),
    status: z.enum(['ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'COMPLETE', 'INACTIVE']).describe('Status value'),
    body: z.string().optional().describe('Status update body (markdown)'),
  },
  async ({ projectId, status, body }) => safe(() => {
    const q = `mutation($p:ID!,$s:ProjectV2StatusUpdateStatus!,$b:String){createProjectV2StatusUpdate(input:{projectId:$p,status:$s,body:$b}){statusUpdate{id status}}}`;
    const args = ['-f', `p=${projectId}`, '-f', `s=${status}`];
    if (body) args.push('-f', `b=${body}`);
    const r = gql(q, ...args);
    return text(r.data);
  }),
);

server.tool(
  'gh_subissue_unlink',
  'Remove a sub-issue link (removeSubIssue). Detaches the child; deletes neither issue.',
  {
    parentNodeId: z.string().describe('Parent issue GraphQL node ID'),
    childNodeId: z.string().describe('Sub-issue GraphQL node ID to detach'),
  },
  async ({ parentNodeId, childNodeId }) => safe(() => {
    const q = `mutation($p:ID!,$c:ID!){removeSubIssue(input:{issueId:$p,subIssueId:$c}){issue{number}}}`;
    const r = gql(q, '-f', `p=${parentNodeId}`, '-f', `c=${childNodeId}`);
    return text(r.data);
  }),
);

server.tool(
  'gh_subissue_reprioritize',
  'Reorder a sub-issue within its parent (reprioritizeSubIssue). Places it after afterChildNodeId, or at the top if omitted.',
  {
    parentNodeId: z.string().describe('Parent issue node ID'),
    childNodeId: z.string().describe('Sub-issue node ID to move'),
    afterChildNodeId: z.string().optional().describe('Place after this sub-issue; omit for top'),
  },
  async ({ parentNodeId, childNodeId, afterChildNodeId }) => safe(() => {
    const decls = ['$p:ID!', '$c:ID!']; const inputs = ['issueId:$p', 'subIssueId:$c']; const args = ['-f', `p=${parentNodeId}`, '-f', `c=${childNodeId}`];
    if (afterChildNodeId) { decls.push('$a:ID'); inputs.push('afterId:$a'); args.push('-f', `a=${afterChildNodeId}`); }
    const q = `mutation(${decls.join(',')}){reprioritizeSubIssue(input:{${inputs.join(',')}}){issue{number}}}`;
    const r = gql(q, ...args);
    return text(r.data);
  }),
);

server.tool(
  'gh_status_update_list',
  'List a project\'s status updates (id, status, body, dates).',
  { projectId: z.string().describe('Project node ID') },
  async ({ projectId }) => safe(() => {
    const q = `query($p:ID!){node(id:$p){... on ProjectV2{statusUpdates(first:20){nodes{id status body startDate targetDate updatedAt}}}}}`;
    const r = gql(q, '-f', `p=${projectId}`);
    return text(r.data.node?.statusUpdates?.nodes ?? []);
  }),
);

server.tool(
  'gh_status_update_edit',
  'Edit an existing project status update (any of status/body/startDate/targetDate).',
  {
    statusUpdateId: z.string().describe('Status update node ID (from gh_status_update_list)'),
    status: z.enum(['ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'COMPLETE', 'INACTIVE']).optional(),
    body: z.string().optional(),
    startDate: z.string().optional().describe('YYYY-MM-DD'),
    targetDate: z.string().optional().describe('YYYY-MM-DD'),
  },
  async ({ statusUpdateId, status, body, startDate, targetDate }) => safe(() => {
    const decls = ['$id:ID!']; const inputs = ['statusUpdateId:$id']; const args = ['-f', `id=${statusUpdateId}`];
    if (status !== undefined) { decls.push('$s:ProjectV2StatusUpdateStatus'); inputs.push('status:$s'); args.push('-f', `s=${status}`); }
    if (body !== undefined) { decls.push('$b:String'); inputs.push('body:$b'); args.push('-f', `b=${body}`); }
    if (startDate !== undefined) { decls.push('$sd:Date'); inputs.push('startDate:$sd'); args.push('-f', `sd=${startDate}`); }
    if (targetDate !== undefined) { decls.push('$td:Date'); inputs.push('targetDate:$td'); args.push('-f', `td=${targetDate}`); }
    if (decls.length === 1) throw new Error('Pass at least one field to edit.');
    const q = `mutation(${decls.join(',')}){updateProjectV2StatusUpdate(input:{${inputs.join(',')}}){statusUpdate{id status}}}`;
    const r = gql(q, ...args);
    return text(r.data.updateProjectV2StatusUpdate.statusUpdate);
  }),
);

server.tool(
  'gh_status_update_delete',
  'Delete a project status update. Destructive — requires confirm:true.',
  {
    statusUpdateId: z.string().describe('Status update node ID'),
    confirm: z.boolean().describe('Must be true to proceed'),
  },
  async ({ statusUpdateId, confirm }) => safe(() => {
    if (!confirm) throw new Error('Refusing to delete status update without confirm:true.');
    const q = `mutation($id:ID!){deleteProjectV2StatusUpdate(input:{statusUpdateId:$id}){clientMutationId}}`;
    gql(q, '-f', `id=${statusUpdateId}`);
    return text('Status update deleted.');
  }),
);

registerViewTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
