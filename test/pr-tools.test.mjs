import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePrCreate, makePrList, makePrMerge } from '../lib/tools-pr.mjs';

// A stub `gh` that records the args it was called with and returns a canned result.
function stubGh(result = { stdout: '' }) {
  const calls = [];
  const fn = (...args) => { calls.push(args); return result; };
  fn.calls = calls;
  return fn;
}

test('gh_pr_create passes base/head/title/body and defaults base to main', async () => {
  const gh = stubGh({ stdout: 'https://github.com/o/r/pull/7' });
  const res = await makePrCreate(gh)({ owner: 'o', repo: 'r', title: 'T', body: 'B', head: 'feat/x' });
  assert.equal(res.isError, undefined);
  assert.equal(res.content[0].text, 'https://github.com/o/r/pull/7');
  assert.deepEqual(gh.calls[0], [
    'pr', 'create', '--repo', 'o/r', '--base', 'main', '--head', 'feat/x', '--title', 'T', '--body', 'B',
  ]);
});

test('gh_pr_create appends --draft when draft is set', async () => {
  const gh = stubGh({ stdout: 'url' });
  await makePrCreate(gh)({ owner: 'o', repo: 'r', title: 'T', head: 'h', base: 'dev', draft: true });
  assert.ok(gh.calls[0].includes('--draft'));
  assert.ok(gh.calls[0].includes('dev'));
});

test('gh_pr_list requests the documented JSON fields and parses the output', async () => {
  const rows = [{ number: 1, title: 'x', url: 'u', state: 'OPEN', headRefName: 'h', baseRefName: 'main', mergeable: 'MERGEABLE', isDraft: false }];
  const gh = stubGh({ stdout: JSON.stringify(rows) });
  const res = await makePrList(gh)({ owner: 'o', repo: 'r' });
  assert.deepEqual(JSON.parse(res.content[0].text), rows);
  const jsonFlagIdx = gh.calls[0].indexOf('--json');
  assert.equal(gh.calls[0][jsonFlagIdx + 1], 'number,title,url,state,headRefName,baseRefName,mergeable,isDraft');
  assert.ok(gh.calls[0].includes('--state') && gh.calls[0].includes('open'));
});

test('gh_pr_merge REFUSES when confirm is not true and does NOT invoke gh', async () => {
  const gh = stubGh();
  const res = await makePrMerge(gh)({ owner: 'o', repo: 'r', number: 5, confirm: false });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /Refusing to merge PR without confirm:true/);
  assert.equal(gh.calls.length, 0, 'gh must not be called on a refused merge');
});

test('gh_pr_merge also refuses when confirm is omitted (undefined)', async () => {
  const gh = stubGh();
  const res = await makePrMerge(gh)({ owner: 'o', repo: 'r', number: 5 });
  assert.equal(res.isError, true);
  assert.equal(gh.calls.length, 0);
});

test('gh_pr_merge with confirm:true squash-merges and deletes the branch by default', async () => {
  const gh = stubGh({ stdout: '' });
  const res = await makePrMerge(gh)({ owner: 'o', repo: 'r', number: 9, confirm: true });
  assert.equal(res.isError, undefined);
  assert.deepEqual(gh.calls[0], [
    'pr', 'merge', '9', '--repo', 'o/r', '--squash', '--delete-branch',
  ]);
});

test('gh_pr_merge honours method and deleteBranch:false', async () => {
  const gh = stubGh({ stdout: '' });
  await makePrMerge(gh)({ owner: 'o', repo: 'r', number: 9, method: 'rebase', deleteBranch: false, confirm: true });
  assert.deepEqual(gh.calls[0], ['pr', 'merge', '9', '--repo', 'o/r', '--rebase']);
});
