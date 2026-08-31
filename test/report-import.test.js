// parseOllinReport against the real thing: the FULL-20260825-infra-VA-Denver
// report an OLLIN full-pathway run actually produced. Before this parser
// existed, pasting this file fell through to the "Company, City, State" line
// reader and made an account out of the first comma-separated field of every
// line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build, fixture } from './_extract.js';

const { parseOllinReport } = build(['ollinreport'], ['parseOllinReport']);
const REPORT = fixture('ollin-full-report.txt');

test('reads the workflow id out of the header', () => {
  assert.equal(parseOllinReport(REPORT).workflowId, 'FULL-20260825-infra-VA-Denver');
});

test('finds every company in the --- COMPANIES --- block', () => {
  const r = parseOllinReport(REPORT);
  assert.equal(r.ok, true);
  assert.deepEqual(r.companies.map(c => c.company), [
    'CleanArc Data Centers',
    'STACK Infrastructure',
    'CoreSite (American Tower)',
    'Flexential',
    'PCL Construction (Denver operations)',
  ]);
});

test('company fields land where the app already looks for them', () => {
  const c = parseOllinReport(REPORT).companies[0];
  assert.equal(c.sector, 'Data center development & operation (digital infrastructure)');
  assert.match(c.wins, /^\$3B VA1 groundbreaking \(Nov 2025, Caroline County\)/);
  assert.match(c.news, /Jim Trout's 25-year data center career/);
  assert.equal(c.workflowId, 'FULL-20260825-infra-VA-Denver');
});

test('a signal keeps its source, and "no second signal found" is dropped', () => {
  const c = parseOllinReport(REPORT).companies[0];
  assert.equal(c.signals.length, 1, 'SIGNAL 2 was "No second signal found."');
  assert.equal(c.signals[0].kind, 'trigger');
  assert.match(c.signals[0].text, /VA1 groundbreaking, \$3B, 900MW/);
  assert.match(c.signals[0].detail, /PR Newswire, Nov 20 2025/);
});

test('a company with two real signals keeps both, typed', () => {
  const c = parseOllinReport(REPORT).companies.find(x => /CoreSite/.test(x.company));
  assert.equal(c.signals.length, 2);
  assert.equal(c.signals[0].kind, 'trigger');
  assert.equal(c.signals[1].kind, 'secondary');
  assert.match(c.signals[1].text, /12-month pause/);
  assert.match(c.signals[1].detail, /Colorado Politics/);
});

test('"No recent news found" is not stored as news', () => {
  const c = parseOllinReport(REPORT).companies.find(x => /STACK/.test(x.company));
  assert.equal(c.news, undefined);
});

test('only the verifiable contacts come through', () => {
  const r = parseOllinReport(REPORT);
  assert.deepEqual(r.contacts.map(c => c.name), [
    'James Trout', 'Jennifer Reininger', 'Christopher Oertel',
    'Camden Holland', 'Ted Travis', 'Mariano Castro',
  ]);
  assert.equal(r.skipped, 3, 'three "Unable to Verify" placeholder records');
});

test('name and title split on the em dash', () => {
  const c = parseOllinReport(REPORT).contacts[0];
  assert.equal(c.name, 'James Trout');
  assert.equal(c.title, 'Founder & CEO');
  assert.equal(c.company, 'CleanArc Data Centers');
  assert.equal(c.linkedin, 'https://www.linkedin.com/in/james-trout-74455a15/');
});

test('a title that itself contains a dash survives', () => {
  const c = parseOllinReport(REPORT).contacts.find(x => x.name === 'Christopher Oertel');
  assert.equal(c.title, 'VP, Program Delivery (was: Director of Program Management)');
});

test('contact signal and its source both survive the wrapped SOURCE line', () => {
  const c = parseOllinReport(REPORT).contacts[0];
  assert.match(c.signal, /Broke ground Nov 20, 2025 on VA1/);
  assert.match(c.signalSrc, /PR Newswire \/ CleanArc press release/);
  assert.equal(c.workflowId, 'FULL-20260825-infra-VA-Denver');
});

test('every contact carries its company, so nothing is orphaned', () => {
  for (const c of parseOllinReport(REPORT).contacts) {
    assert.ok(c.company && c.company.trim(), `${c.name} has no company`);
  }
});

test('a report with no blocks is not ok, and never throws', () => {
  const r = parseOllinReport('Workflow ID: SIG-20260101-nothing\n\nnothing here.\n');
  assert.equal(r.ok, false);
  assert.equal(r.workflowId, 'SIG-20260101-nothing');
  assert.deepEqual(r.companies, []);
});

test('empty and junk input are handled, not thrown', () => {
  for (const bad of ['', null, undefined, '   ', 'Acme, Austin, TX']) {
    assert.equal(parseOllinReport(bad).ok, false);
  }
});

test('CRLF line endings parse identically', () => {
  const a = parseOllinReport(REPORT);
  const b = parseOllinReport(REPORT.replace(/\n/g, '\r\n'));
  assert.deepEqual(b.companies.map(c => c.company), a.companies.map(c => c.company));
  assert.deepEqual(b.contacts.map(c => c.name), a.contacts.map(c => c.name));
});

test('parsing is pure — the same text twice gives the same answer', () => {
  assert.deepEqual(parseOllinReport(REPORT), parseOllinReport(REPORT));
});
