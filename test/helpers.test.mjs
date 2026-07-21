import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gqlStr,
  makeOwnerRoot,
  assertConfirmed,
  guardOptionRemoval,
  normalizeTabText,
  viewNamesFromTabTexts,
} from '../lib/helpers.mjs';

test('gqlStr escapes backslashes and double quotes', () => {
  assert.equal(gqlStr('plain'), 'plain');
  assert.equal(gqlStr('say "hi"'), 'say \\"hi\\"');
  assert.equal(gqlStr('a\\b'), 'a\\\\b');
  // Backslash then quote: backslash escaped first, then the quote.
  assert.equal(gqlStr('a\\"b'), 'a\\\\\\"b');
  assert.equal(gqlStr(5), '5');
});

test('makeOwnerRoot returns organization when the API type is Organization', () => {
  const ownerRoot = makeOwnerRoot(() => ({ stdout: 'Organization\n' }));
  assert.equal(ownerRoot('some-org'), 'organization');
});

test('makeOwnerRoot returns user for a User type', () => {
  const ownerRoot = makeOwnerRoot(() => ({ stdout: 'User\n' }));
  assert.equal(ownerRoot('some-user'), 'user');
});

test('makeOwnerRoot caches per owner — gh is called once per owner', () => {
  let calls = 0;
  const ownerRoot = makeOwnerRoot((...args) => {
    calls++;
    return { stdout: args[1] === 'users/anorg' ? 'Organization' : 'User' };
  });
  assert.equal(ownerRoot('anorg'), 'organization');
  assert.equal(ownerRoot('anorg'), 'organization'); // cached
  assert.equal(calls, 1);
  assert.equal(ownerRoot('auser'), 'user');
  assert.equal(calls, 2);
});

test('makeOwnerRoot defaults to user when gh throws', () => {
  const ownerRoot = makeOwnerRoot(() => { throw new Error('gh not found'); });
  assert.equal(ownerRoot('whoever'), 'user');
});

test('assertConfirmed throws unless confirm === true', () => {
  assert.throws(() => assertConfirmed(false, 'merge PR'), /Refusing to merge PR without confirm:true/);
  assert.throws(() => assertConfirmed(undefined, 'delete view'), /confirm:true/);
  assert.throws(() => assertConfirmed('true', 'delete field'), /confirm:true/); // strict: not the boolean
  assert.doesNotThrow(() => assertConfirmed(true, 'delete field'));
});

test('guardOptionRemoval throws when dropping options without allowRemove', () => {
  assert.throws(
    () => guardOptionRemoval(['A', 'B', 'C'], ['A', 'C'], false),
    /would DELETE options not in your list: B/,
  );
});

test('guardOptionRemoval permits removals when allowRemove is true', () => {
  const removed = guardOptionRemoval(['A', 'B'], ['A'], true);
  assert.deepEqual(removed, ['B']);
});

test('guardOptionRemoval is a no-op when nothing is dropped', () => {
  const removed = guardOptionRemoval(['A', 'B'], ['A', 'B', 'C'], false);
  assert.deepEqual(removed, []);
});

test('normalizeTabText strips the leading "+" affordance and trims', () => {
  assert.equal(normalizeTabText('+ New view'), 'New view');
  assert.equal(normalizeTabText('  Backlog  '), 'Backlog');
  assert.equal(normalizeTabText('+Roadmap'), 'Roadmap');
});

test('viewNamesFromTabTexts drops empties and the New view placeholder', () => {
  const names = viewNamesFromTabTexts(['Board', '+ New view', '  ', 'Roadmap', 'new view']);
  assert.deepEqual(names, ['Board', 'Roadmap']);
});
