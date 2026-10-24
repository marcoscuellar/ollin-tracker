// Activation rulebook: one case per row, plus the two promises — a reply
// beats a scheduled touch, and no event ever produces a send.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from './_extract.js';
import { noteEngagement } from '../api/_activation-lib.js';

// The rulebook lives in index.html (/* @export:activation */); pull it out
// the same way the Mushroom and schedule tests do.
const { nextMoveFor, engagementFacts, engagementLine, STATE_RANK } =
  build(['activation'], ['nextMoveFor', 'engagementFacts', 'engagementLine', 'STATE_RANK']);

const now = new Date('2026-10-22T15:00:00'); // Thursday
const ev = (kind, daysAgo, extra = {}) => ({ kind, at: new Date(now.getTime() - daysAgo * 86400000).toISOString(), ...extra });
const next = (over = {}) => ({ touchNo: 3, ch: 'li', date: '2026-10-27', ...over });
const move = (events, nextTouch = next(), thread = {}) => nextMoveFor({ thread: { ...thread, events }, nextTouch, now });

test('untouched contact is cold and keeps its date', () => {
  const r = move([]);
  assert.equal(r.state, 'cold'); assert.equal(r.proposal.kind, 'keep');
});

test('a positive reply stops the sequence and asks for an answer', () => {
  const r = move([ev('sent', 3, { channel: 'em' }), ev('replied', 1, { detail: { tone: 'positive' } })]);
  assert.equal(r.state, 'replied'); assert.equal(r.proposal.kind, 'reply');
});

test('a negative reply opts them out', () => {
  const r = move([ev('sent', 3), ev('replied', 1, { detail: { tone: 'negative' } })]);
  assert.equal(r.state, 'opted_out'); assert.equal(r.proposal.kind, 'stop');
});

test('"later" with a date parks until that date', () => {
  const r = move([ev('sent', 3), ev('replied', 1, { detail: { tone: 'later', date: '2027-01-12' } })]);
  assert.equal(r.state, 'parked'); assert.equal(r.proposal.kind, 'park'); assert.equal(r.proposal.date, '2027-01-12');
});

test('out of office pushes the next touch past the return date', () => {
  const r = move([ev('sent', 1, { channel: 'em' }), ev('ooo', 1, { detail: { date: '2026-11-02' } })], next({ date: '2026-10-25' }));
  assert.equal(r.proposal.kind, 'push'); assert.equal(r.proposal.date, '2026-11-02');
});

test('a click pulls the next touch forward to tomorrow', () => {
  const r = move([ev('sent', 2, { channel: 'em' }), ev('opened', 1), ev('clicked', 1)]);
  assert.equal(r.state, 'warm'); assert.equal(r.proposal.kind, 'pull_forward'); assert.equal(r.proposal.date, '2026-10-23');
  assert.match(r.proposal.reason, /yesterday/);
});

test('an old click no longer pulls forward', () => {
  const r = move([ev('sent', 12, { channel: 'em' }), ev('clicked', 10)]);
  assert.notEqual(r.proposal.kind, 'pull_forward');
});

test('three opens and no click become a nudge', () => {
  const r = move([ev('sent', 4, { channel: 'em' }), ev('opened', 3), ev('opened', 2), ev('opened', 1)]);
  assert.equal(r.state, 'warm'); assert.equal(r.proposal.kind, 'nudge');
});

test('two unopened emails switch the next email to LinkedIn', () => {
  const r = move([ev('sent', 8, { channel: 'em' }), ev('sent', 3, { channel: 'em' })], next({ ch: 'em' }));
  assert.equal(r.state, 'cold'); assert.equal(r.proposal.kind, 'switch_channel'); assert.equal(r.proposal.channel, 'li');
});

test('two unopened emails with a LinkedIn touch next → pause', () => {
  const r = move([ev('sent', 8, { channel: 'em' }), ev('sent', 3, { channel: 'em' })], next({ ch: 'li' }));
  assert.equal(r.proposal.kind, 'pause');
});

test('LinkedIn accepted after the last touch pulls the next one forward', () => {
  const r = move([ev('sent', 2, { channel: 'li' }), ev('li_accepted', 1)]);
  assert.equal(r.state, 'warm'); assert.equal(r.proposal.kind, 'pull_forward');
});

test('bounce and complaint are hard stops', () => {
  assert.equal(move([ev('sent', 1), ev('bounced', 1)]).proposal.kind, 'stop');
  assert.equal(move([ev('sent', 1), ev('complained', 1)]).state, 'opted_out');
  assert.equal(move([ev('sent', 1)], next(), { optOut: true }).state, 'opted_out');
});

test('sequence complete and silent for 14 days → resting', () => {
  const r = move([ev('sent', 30), ev('sent', 20, { channel: 'em' })], null);
  assert.equal(r.state, 'resting'); assert.equal(r.proposal.kind, 'stop');
  const r2 = move([ev('sent', 5)], null);
  assert.equal(r2.proposal.kind, 'keep');
});

test('a new signal on a resting contact proposes a restart', () => {
  const r = move([ev('sent', 30), ev('signal', 0, { detail: { text: 'Series C closed' } })], null);
  assert.equal(r.proposal.kind, 'restart'); assert.match(r.proposal.reason, /Series C/);
});

test('a new signal on a parked contact proposes a restart', () => {
  const r = move([ev('sent', 10), ev('replied', 9, { detail: { tone: 'later', date: '2027-01-10' } }), ev('signal', 0, { detail: { text: 'New COO' } })]);
  assert.equal(r.proposal.kind, 'restart');
});

test('a reply outranks everything in Up Next', () => {
  assert.ok(STATE_RANK.replied < STATE_RANK.warm && STATE_RANK.warm < STATE_RANK.touched && STATE_RANK.touched < STATE_RANK.cold);
});

test('no event ever produces a send', () => {
  const kinds = new Set();
  const logs = [
    [], [ev('sent', 1)], [ev('sent', 1), ev('opened', 0)], [ev('sent', 1), ev('clicked', 0)],
    [ev('sent', 1), ev('replied', 0, { detail: { tone: 'positive' } })], [ev('sent', 1), ev('li_accepted', 0)],
    [ev('sent', 9), ev('sent', 2)], [ev('sent', 30)], [ev('sent', 30), ev('signal', 0)],
  ];
  for (const l of logs) for (const nt of [next(), next({ ch: 'em' }), null]) kinds.add(move(l, nt).proposal.kind);
  for (const k of kinds) assert.ok(['keep', 'pull_forward', 'push', 'nudge', 'switch_channel', 'pause', 'stop', 'park', 'reply', 'restart'].includes(k), k);
  assert.ok(!kinds.has('send') && !kinds.has('queue'));
});

test('engagement facts and the writer line', () => {
  const f = engagementFacts([ev('sent', 4, { channel: 'em' }), ev('opened', 3), ev('opened', 2), ev('clicked', 1)], now);
  assert.equal(f.emailsSent, 1); assert.equal(f.opens, 2); assert.equal(f.clicks, 1); assert.equal(f.clickedRecently, true);
  const line = engagementLine(f, { kind: 'pull_forward' });
  assert.match(line, /opened 2 times/); assert.match(line, /clicked the link/); assert.match(line, /what they clicked/);
  assert.equal(engagementLine(engagementFacts([], now), { kind: 'keep' }), '');
});

test('noteEngagement counts opens and clicks on a queue entry', () => {
  const e = { status: 'delivered' };
  noteEngagement(e, 'email.opened', '2026-10-22T12:00:00Z'); noteEngagement(e, 'email.opened', '2026-10-22T13:00:00Z'); noteEngagement(e, 'email.clicked', '2026-10-22T13:01:00Z');
  assert.equal(e.opens, 2); assert.equal(e.clicks, 1); assert.equal(e.firstOpenAt, '2026-10-22T12:00:00Z'); assert.equal(e.lastClickAt, '2026-10-22T13:01:00Z');
});
