/**
 * Pull-request tools — thin wrappers over the `gh pr` CLI, mirroring the
 * gh_issue_* style in server.mjs.
 *
 * Handlers are exposed as factories that take `gh` as a dependency so they can be
 * unit-tested with a stub (see test/pr-tools.test.mjs). registerPrTools() wires
 * them to the real gh from lib/gql.mjs, matching the registerViewTools() pattern.
 */
import { z } from 'zod';
import { gh as realGh } from './gql.mjs';
import { assertConfirmed } from './helpers.mjs';

function text(t) {
  return { content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] };
}

function errorText(err) {
  return { isError: true, content: [{ type: 'text', text: err.message ?? String(err) }] };
}

async function safe(fn) {
  try { return await fn(); } catch (err) { return errorText(err); }
}

/** gh_pr_create handler bound to an injectable gh. */
export function makePrCreate(gh) {
  return async ({ owner, repo, title, body, base, head, draft }) => safe(() => {
    const args = ['pr', 'create', '--repo', `${owner}/${repo}`, '--base', base ?? 'main', '--head', head, '--title', title, '--body', body ?? ''];
    if (draft) args.push('--draft');
    const r = gh(...args);
    return text(r.stdout);
  });
}

/** gh_pr_list handler bound to an injectable gh. */
export function makePrList(gh) {
  return async ({ owner, repo, state, limit }) => safe(() => {
    const r = gh('pr', 'list', '--repo', `${owner}/${repo}`, '--state', state ?? 'open', '--limit', String(limit ?? 50), '--json', 'number,title,url,state,headRefName,baseRefName,mergeable,isDraft');
    return text(JSON.parse(r.stdout));
  });
}

/** gh_pr_merge handler bound to an injectable gh. Confirm-gated (destructive). */
export function makePrMerge(gh) {
  return async ({ owner, repo, number, method, deleteBranch, confirm }) => safe(() => {
    assertConfirmed(confirm, 'merge PR');
    const flag = { squash: '--squash', merge: '--merge', rebase: '--rebase' }[method ?? 'squash'];
    const args = ['pr', 'merge', String(number), '--repo', `${owner}/${repo}`, flag];
    if (deleteBranch ?? true) args.push('--delete-branch');
    const r = gh(...args);
    return text(r.stdout || `Merged PR #${number} (${method ?? 'squash'}).`);
  });
}

export function registerPrTools(server, deps = {}) {
  const gh = deps.gh ?? realGh;

  server.tool(
    'gh_pr_create',
    'Open a pull request in a repo (wraps `gh pr create`). head is the branch to merge FROM; base (default "main") is the branch to merge INTO. Returns the created PR URL.',
    {
      owner: z.string().describe('Repo owner login'),
      repo: z.string().describe('Repo name (without owner)'),
      title: z.string().describe('PR title'),
      body: z.string().optional().describe('PR body (markdown)'),
      base: z.string().optional().describe('Base branch to merge into (default "main")'),
      head: z.string().describe('Head branch to merge from'),
      draft: z.boolean().optional().describe('Open as a draft PR'),
    },
    makePrCreate(gh),
  );

  server.tool(
    'gh_pr_list',
    'List pull requests in a repo (wraps `gh pr list`) with number, title, url, state, head/base branches, mergeability, and draft flag.',
    {
      owner: z.string().describe('Repo owner login'),
      repo: z.string().describe('Repo name (without owner)'),
      state: z.enum(['open', 'closed', 'merged', 'all']).optional().describe('Filter by state (default "open")'),
      limit: z.number().optional().describe('Max PRs to return (default 50)'),
    },
    makePrList(gh),
  );

  server.tool(
    'gh_pr_merge',
    'Merge a pull request (wraps `gh pr merge`). Destructive — requires confirm:true. Defaults to a squash merge and deletes the head branch afterwards.',
    {
      owner: z.string().describe('Repo owner login'),
      repo: z.string().describe('Repo name (without owner)'),
      number: z.number().describe('PR number to merge'),
      method: z.enum(['squash', 'merge', 'rebase']).optional().describe('Merge method (default "squash")'),
      deleteBranch: z.boolean().optional().describe('Delete the head branch after merge (default true)'),
      confirm: z.boolean().describe('Must be true to proceed — merging cannot be undone'),
    },
    makePrMerge(gh),
  );
}
