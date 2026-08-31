// The cadence used to be dated once, at account creation: acct.start + 0/2/5/8.
// On any account older than eight days that meant every remaining touch was
// already overdue, so sending one didn't schedule the next — it revealed it
// late, and the queue could never drain.
//
// Now only touch 1 is dated. Touch N+1 gets its date when touch N is sent,
// from today plus a gap the user picks (1, 3 or 5 days).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from './_extract.js';

const S = build(
  ['cadence', 'dates', 'schedule'],
  ['state', 'CADENCE', 'GAPS', 'GAP_DEFAULT', 'buildTouches', 'firstTouchDate',
   'nextTouchId', 'scheduleNext', 'migrateSchedule', 'todayStr', 'iso', 'addDays', 'shiftWeekend', 'parse'],
  'var state = { done:{}, reschedule:{}, accounts:[], extra:{} };\nvar __state = null;'
);
const { CADENCE, GAPS, GAP_DEFAULT, buildTouches, nextTouchId, scheduleNext, migrateSchedule,
        todayStr, iso, addDays, shiftWeekend } = S;

// the extracted code closes over its own `state`; these reach the same object
const reset = () => { S.state.done = {}; S.state.reschedule = {}; S.state.accounts = []; S.state.extra = {}; };
const back = (n) => iso(addDays(todayStr(), -n));
const fwd = (n) => iso(shiftWeekend(addDays(todayStr(), n)));

function account(startDaysAgo, thread = {}) {
  return {
    id: 'a1', company: 'Acme', start: back(startDaysAgo),
    threads: [Object.assign({ id: 't1', name: 'Dana', persona: 'Champion', entryDay: 1 }, thread)],
  };
}

test('the only gaps offered are 1, 3 and 5 days', () => {
  assert.deepEqual(GAPS, [1, 3, 5]);
  assert.ok(GAPS.includes(GAP_DEFAULT));
});

test('only the first touch is dated — the rest wait to be scheduled', () => {
  reset();
  const ts = buildTouches(account(90));
  assert.equal(ts.length, CADENCE.length);
  assert.ok(ts[0].date, 'touch 1 must always have a date');
  for (let i = 1; i < ts.length; i++) {
    assert.equal(ts[i].date, null, `touch ${i + 1} must be undated until touch ${i} is sent`);
  }
});

test('a 90-day-old account no longer produces four overdue touches', () => {
  reset();
  const overdue = buildTouches(account(90)).filter(t => t.date && t.date < todayStr());
  assert.equal(overdue.length, 1, 'only touch 1 can be overdue');
});

test('sending touch 1 schedules touch 2 from today, not from acct.start', () => {
  reset();
  const ts = buildTouches(account(90));
  const landed = scheduleNext(ts[0], 3);
  assert.equal(landed, fwd(3));
  assert.equal(S.state.reschedule[ts[1].id], fwd(3));
  assert.ok(landed >= todayStr(), 'a freshly scheduled touch is never in the past');
});

test('each of the three gaps lands where it says', () => {
  for (const g of GAPS) {
    reset();
    const ts = buildTouches(account(90));
    assert.equal(scheduleNext(ts[0], g), fwd(g), `+${g} days`);
  }
});

test('an unknown gap falls back to the default rather than producing a bad date', () => {
  reset();
  const ts = buildTouches(account(90));
  assert.equal(scheduleNext(ts[0], 47), fwd(GAP_DEFAULT));
  reset();
  assert.equal(scheduleNext(buildTouches(account(90))[0], undefined), fwd(GAP_DEFAULT));
});

test('the last touch has nothing after it', () => {
  reset();
  const ts = buildTouches(account(90));
  assert.equal(nextTouchId(ts[ts.length - 1]), null);
  assert.equal(scheduleNext(ts[ts.length - 1], 3), null);
});

test('scheduling walks the whole sequence forward, one send at a time', () => {
  reset();
  const ts = buildTouches(account(90));
  for (let i = 0; i < CADENCE.length - 1; i++) {
    S.state.done[ts[i].id] = todayStr();
    const landed = scheduleNext(ts[i], 1);
    assert.equal(landed, fwd(1), `touch ${i + 2} scheduled`);
    assert.ok(landed >= todayStr());
  }
});

test('a contact added today to an old account starts today, not months ago', () => {
  reset();
  const old = buildTouches(account(120))[0].date;
  const fresh = buildTouches(account(120, { addedAt: todayStr() }))[0].date;
  assert.ok(old < todayStr(), 'without addedAt it inherits the old start');
  assert.equal(fresh, fwd(0), 'with addedAt it starts from today');
});

test('a scheduled date never lands on a weekend', () => {
  for (const g of GAPS) {
    reset();
    const landed = scheduleNext(buildTouches(account(90))[0], g);
    const day = S.parse(landed).getDay();
    assert.ok(day !== 0 && day !== 6, `${landed} is a weekend`);
  }
});

// ---- migration: drain the backlog the old scheme left behind ---------------

test('migration schedules what follows the last send, never into the past', () => {
  reset();
  S.state.accounts = [account(120)];
  S.state.done['a1|t1|0'] = back(60);          // touch 1 sent two months ago
  const n = migrateSchedule();
  assert.equal(n, 1);
  const when = S.state.reschedule['a1|t1|1'];
  assert.ok(when >= todayStr(), `${when} must not be in the past`);
});

test('migration keeps a recent send on its natural gap', () => {
  reset();
  S.state.accounts = [account(120)];
  S.state.done['a1|t1|0'] = todayStr();
  migrateSchedule();
  assert.equal(S.state.reschedule['a1|t1|1'], fwd(GAP_DEFAULT));
});

test('migration leaves untouched and finished contacts alone', () => {
  reset();
  S.state.accounts = [account(120)];
  assert.equal(migrateSchedule(), 0, 'never sent — touch 1 already has its date');

  reset();
  S.state.accounts = [account(120)];
  for (let i = 0; i < CADENCE.length; i++) S.state.done[`a1|t1|${i}`] = back(3);
  assert.equal(migrateSchedule(), 0, 'sequence finished — nothing follows');
});

test('migration never overwrites a date the user already chose', () => {
  reset();
  S.state.accounts = [account(120)];
  S.state.done['a1|t1|0'] = back(60);
  S.state.reschedule['a1|t1|1'] = fwd(5);
  migrateSchedule();
  assert.equal(S.state.reschedule['a1|t1|1'], fwd(5));
});

test('migration runs once and then stays out of the way', () => {
  reset();
  S.state.accounts = [account(120)];
  S.state.done['a1|t1|0'] = back(60);
  assert.equal(migrateSchedule(), 1);
  assert.equal(S.state.extra.schedV2, 1);
  S.state.reschedule = {};
  assert.equal(migrateSchedule(), 0, 'second call is a no-op');
});

test('blockers are never sequenced', () => {
  reset();
  assert.equal(buildTouches(account(10, { persona: 'Blocker' })).length, 0);
  S.state.accounts = [account(10, { persona: 'Blocker' })];
  assert.equal(migrateSchedule(), 0);
});
