import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeViewDeleteHandler } from '../lib/tools-views.mjs';

test('gh_project_view_delete REFUSES on confirm:false without driving Playwright', async () => {
  let called = 0;
  const withProjectPage = () => { called++; return true; };
  const res = await makeViewDeleteHandler(withProjectPage)({ owner: 'o', number: 1, viewName: 'Board', confirm: false });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /Refusing to delete view without confirm:true/);
  assert.equal(called, 0, 'withProjectPage must not run on a refused delete');
});

test('gh_project_view_delete drives the injected page runner when confirmed', async () => {
  const seen = [];
  // Simulate the Playwright driver resolving to a successful deletion, without
  // invoking the real deleteViewByName (that needs a live page).
  const withProjectPage = async (owner, number, fn) => {
    seen.push({ owner, number, fnIsFunction: typeof fn === 'function' });
    return true;
  };
  const res = await makeViewDeleteHandler(withProjectPage)({ owner: 'o', number: 3, viewName: 'Board', confirm: true });
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /Deleted view "Board"/);
  assert.deepEqual(seen, [{ owner: 'o', number: 3, fnIsFunction: true }]);
});

test('gh_project_view_delete reports a not-found result without throwing', async () => {
  const res = await makeViewDeleteHandler(async () => false)({ owner: 'o', number: 1, viewName: 'Ghost', confirm: true });
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /Could not find or delete view "Ghost"/);
});
