// Reporting lines on the Mushroom map: which ones draw solid, what each one
// says about where it came from, and how an imported "Reports To" name is
// resolved to a contact. A human-supplied line is never labelled "verified" —
// that word is Engine 6's alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from './_extract.js';

const { muLineOf, muLineSolid, muLinkByManagerName, muNormName } =
  build(['mureports'], ['muLineOf', 'muLineSolid', 'muLinkByManagerName', 'muNormName']);

const boss = { id: 't1', name: 'Matt Strange', title: 'COO' };
const byId = { t1: boss };

test('no reportsTo → placed by role, dashed', () => {
  const t = { id: 't2', name: 'Katy Zahrte' };
  assert.deepEqual(muLineOf(t, byId), { cls: '', txt: 'placed by role · inferred' });
  assert.equal(muLineSolid(t), false);
});

test('engine-verified line says verified and is solid', () => {
  const t = { id: 't2', reportsTo: 't1', relVerified: true };
  assert.deepEqual(muLineOf(t, byId), { cls: 'ok', txt: 'reports to Matt · verified' });
  assert.equal(muLineSolid(t), true);
});

test('user-set line is solid and says set by you — never "verified"', () => {
  const t = { id: 't2', reportsTo: 't1', relSource: 'user' };
  const ln = muLineOf(t, byId);
  assert.equal(ln.cls, 'ok');
  assert.equal(ln.txt, 'reports to Matt · set by you');
  assert.doesNotMatch(ln.txt, /verified/);
  assert.equal(muLineSolid(t), true);
});

test('imported line is solid and says from your import', () => {
  const t = { id: 't2', reportsTo: 't1', relSource: 'import' };
  assert.deepEqual(muLineOf(t, byId), { cls: 'ok', txt: 'reports to Matt · from your import' });
  assert.equal(muLineSolid(t), true);
});

test('engine-inferred (reportsTo without verification or source) stays dashed', () => {
  const t = { id: 't2', reportsTo: 't1' };
  assert.deepEqual(muLineOf(t, byId), { cls: '', txt: 'reports to Matt · inferred' });
  assert.equal(muLineSolid(t), false);
});

test('reportsTo pointing at someone not on the account draws nothing', () => {
  const t = { id: 't2', reportsTo: 'ghost', relSource: 'user' };
  assert.equal(muLineOf(t, byId).txt, 'placed by role · inferred');
});

test('name normalisation ignores case, punctuation and spacing', () => {
  assert.equal(muNormName('  Matt   Strange '), 'matt strange');
  assert.equal(muNormName('MATT STRANGE'), 'matt strange');
  assert.equal(muNormName('Matt-Strange.'), 'matt strange');
});

test('import: manager name resolves to the matching contact on the same account', () => {
  const threads = [
    { id: 'a', name: 'Matt Strange' },
    { id: 'b', name: 'Katy Zahrte' },
    { id: 'c', name: 'Jared LightWright' },
  ];
  const r = muLinkByManagerName(threads, { b: 'matt strange', c: 'Katy Zahrte' });
  assert.deepEqual(r, { linked: 2, unmatched: 0 });
  assert.equal(threads[1].reportsTo, 'a');
  assert.equal(threads[1].relSource, 'import');
  assert.equal(threads[2].reportsTo, 'b');
});

test('import: an unmatched name is kept on the contact and draws nothing', () => {
  const threads = [{ id: 'a', name: 'Matt Strange' }, { id: 'b', name: 'Katy Zahrte' }];
  const r = muLinkByManagerName(threads, { b: 'Someone Else' });
  assert.deepEqual(r, { linked: 0, unmatched: 1 });
  assert.equal(threads[1].reportsTo, undefined);
  assert.equal(threads[1].managerName, 'Someone Else');
});

test('import: never links a person to themselves', () => {
  const threads = [{ id: 'a', name: 'Matt Strange' }];
  const r = muLinkByManagerName(threads, { a: 'Matt Strange' });
  assert.equal(r.linked, 0);
  assert.equal(threads[0].reportsTo, undefined);
});

test('import: never overwrites a line Engine 6 verified', () => {
  const threads = [
    { id: 'a', name: 'Matt Strange' },
    { id: 'b', name: 'Katy Zahrte', reportsTo: 'c', relVerified: true },
    { id: 'c', name: 'Sara Wilson' },
  ];
  muLinkByManagerName(threads, { b: 'Matt Strange' });
  assert.equal(threads[1].reportsTo, 'c');
  assert.equal(threads[1].relVerified, true);
});

test('import: rows without a manager value are untouched', () => {
  const threads = [{ id: 'a', name: 'Matt Strange', reportsTo: 'x', relSource: 'user' }];
  muLinkByManagerName(threads, {});
  assert.equal(threads[0].reportsTo, 'x');
  assert.equal(threads[0].relSource, 'user');
});
