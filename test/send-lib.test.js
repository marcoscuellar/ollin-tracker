// Scheduled outreach, the pure half: settings validation, the morning send
// window and spread, the guardrails, the bodies, the webhook signature.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  normalizeSendSettings, effectiveSettings, parseAddress, formatAddress,
  zonedTimeToUtc, localDateStr, slotFor, queueGuards, emailConfidencePct,
  countQueuedOnDay, bodiesFor, OPT_OUT_LINE, tagValue, untagValue,
  verifySvix, statusForEvent, advanceStatus, SPREAD_MIN_MINUTES,
} from '../api/_send-lib.js';

const user = { email: 'Marcos@elipangroup.com', sender: { name: 'Marcos Cuellar' } };
const env = { SEND_DOMAINS: 'ollinos.com' };

// ---------- settings ----------
test('send-as must be on an allowed domain', () => {
  const bad = normalizeSendSettings({ sendAs: 'marcos@gmail.com' }, user, env);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /ollinos\.com/);
  const good = normalizeSendSettings({ sendAs: 'marcos@ollinos.com' }, user, env);
  assert.equal(good.ok, true);
  assert.equal(good.send.sendAs, 'Marcos Cuellar <marcos@ollinos.com>');
});

test('reply-to defaults to the login email, lower-cased', () => {
  const r = normalizeSendSettings({ sendAs: 'marcos@ollinos.com' }, user, env);
  assert.equal(r.send.replyTo, 'marcos@elipangroup.com');
});

test('defaults: 07:30, cap 25, horizon 7, not paused', () => {
  const r = normalizeSendSettings({}, user, env);
  assert.equal(r.send.sendHour, '07:30');
  assert.equal(r.send.dailyCap, 25);
  assert.equal(r.send.horizonDays, 7);
  assert.equal(r.send.paused, false);
});

test('bounds: cap 1..100, horizon 1..14, hour HH:MM, real timezone', () => {
  assert.equal(normalizeSendSettings({ dailyCap: 0 }, user, env).ok, false);
  assert.equal(normalizeSendSettings({ dailyCap: 101 }, user, env).ok, false);
  assert.equal(normalizeSendSettings({ horizonDays: 15 }, user, env).ok, false);
  assert.equal(normalizeSendSettings({ sendHour: '7:30' }, user, env).ok, false);
  assert.equal(normalizeSendSettings({ sendHour: '07:30' }, user, env).ok, true);
  assert.equal(normalizeSendSettings({ tz: 'Mars/Olympus' }, user, env).ok, false);
  assert.equal(normalizeSendSettings({ tz: 'America/Chicago' }, user, env).send.tz, 'America/Chicago');
});

test('effective settings merge stored values over defaults', () => {
  const s = effectiveSettings({ email: 'a@b.co', send: { sendHour: '08:00' } });
  assert.equal(s.sendHour, '08:00');
  assert.equal(s.dailyCap, 25);
  assert.equal(s.replyTo, 'a@b.co');
});

test('address parsing accepts bare and named forms', () => {
  assert.deepEqual(parseAddress('marcos@ollinos.com'), { name: '', address: 'marcos@ollinos.com' });
  assert.deepEqual(parseAddress('Marcos C <Marcos@Ollinos.com>'), { name: 'Marcos C', address: 'marcos@ollinos.com' });
  assert.equal(parseAddress('nope'), null);
  assert.equal(formatAddress('A <b>', 'x@y.co'), 'A b <x@y.co>');
});

// ---------- time ----------
test('07:30 New York on a standard-time date is 12:30Z; on a DST date 11:30Z', () => {
  assert.equal(zonedTimeToUtc('2026-01-15', '07:30', 'America/New_York').toISOString(), '2026-01-15T12:30:00.000Z');
  assert.equal(zonedTimeToUtc('2026-07-15', '07:30', 'America/New_York').toISOString(), '2026-07-15T11:30:00.000Z');
});

test('local date respects the zone', () => {
  assert.equal(localDateStr(new Date('2026-10-22T03:00:00Z'), 'America/New_York'), '2026-10-21');
  assert.equal(localDateStr(new Date('2026-10-22T03:00:00Z'), 'Europe/Madrid'), '2026-10-22');
});

test('slots: first touch at the send hour, later ones spread, never a burst', () => {
  const settings = { sendHour: '07:30', tz: 'America/New_York' };
  const now = new Date('2026-10-20T00:00:00Z');
  const a = slotFor({ dueDate: '2026-10-22', settings, indexInDay: 0, touchKey: 'a|1|1', now });
  const b = slotFor({ dueDate: '2026-10-22', settings, indexInDay: 1, touchKey: 'b|1|1', now });
  const c = slotFor({ dueDate: '2026-10-22', settings, indexInDay: 2, touchKey: 'c|1|1', now });
  const base = zonedTimeToUtc('2026-10-22', '07:30', 'America/New_York').getTime();
  for (const s of [a, b, c]) assert.ok(s.getTime() >= base, 'not before the send hour');
  assert.ok(b.getTime() >= a.getTime() + (SPREAD_MIN_MINUTES - 4) * 60000);
  assert.ok(c.getTime() > a.getTime());
  // same inputs, same slot — jitter is deterministic
  assert.equal(slotFor({ dueDate: '2026-10-22', settings, indexInDay: 0, touchKey: 'a|1|1', now }).getTime(), a.getTime());
});

test('slot already in the past moves to a few minutes from now', () => {
  const settings = { sendHour: '07:30', tz: 'America/New_York' };
  const now = new Date('2026-10-22T15:00:00Z'); // 11:00 local
  const s = slotFor({ dueDate: '2026-10-22', settings, indexInDay: 0, touchKey: 'x', now });
  const delta = (s.getTime() - now.getTime()) / 60000;
  assert.ok(delta >= 2 && delta <= 6, 'between 2 and 6 minutes out, got ' + delta);
});

// ---------- guardrails ----------
const settings = { sendAs: 'Marcos <marcos@ollinos.com>', replyTo: 'm@x.co', sendHour: '07:30', tz: 'America/New_York', dailyCap: 2, horizonDays: 7, paused: false };
const now = new Date('2026-10-20T14:00:00Z'); // 10:00 local, 2026-10-20
const touch = { id: 'a|t|1', ch: 'em', touchNo: 2 };
const contact = { id: 't', name: 'Dana Rivera', persona: 'Champion', email: 'd.rivera@aldervane.example', emailConf: '92%' };

test('a clean email touch passes', () => {
  assert.deepEqual(queueGuards({ contact, touch, settings, draft: 'Subject: x\n\nhi', dueDate: '2026-10-22', now }), []);
});

test('blockers, no email, low confidence, bounced, suppressed, paused, LinkedIn all refuse', () => {
  const g = (c, t = touch, s = settings) => queueGuards({ contact: c, touch: t, settings: s, draft: 'Subject: x\n\nhi', dueDate: '2026-10-22', now });
  assert.match(g({ ...contact, persona: 'Blocker' })[0], /never sequenced/);
  assert.match(g({ ...contact, email: '' })[0], /No usable email/);
  assert.match(g({ ...contact, emailConf: '55%' })[0], /55%/);
  assert.match(g({ ...contact, emailStatus: 'bounce' })[0], /bounced/);
  assert.match(g({ ...contact, optOut: true })[0], /not to be contacted/);
  assert.match(g(contact, touch, { ...settings, paused: true })[0], /paused/);
  assert.match(g(contact, { ...touch, ch: 'li' })[0], /Only email/);
  assert.match(g(contact, touch, { ...settings, sendAs: '' })[0], /send-as/);
});

test('missing confidence is allowed (the user supplied the address); empty draft and audit failures refuse', () => {
  assert.deepEqual(queueGuards({ contact: { ...contact, emailConf: undefined }, touch, settings, draft: 'x', dueDate: '2026-10-22', now }), []);
  assert.match(queueGuards({ contact, touch, settings, draft: '  ', dueDate: '2026-10-22', now })[0], /empty/);
  assert.match(queueGuards({ contact, touch, settings, draft: 'x', auditFailures: ['Uses the banned word "help".'], dueDate: '2026-10-22', now })[0], /audit/);
});

test('horizon: 8 days out refuses, 7 passes', () => {
  assert.match(queueGuards({ contact, touch, settings, draft: 'x', dueDate: '2026-10-28', now })[0], /7 days out/);
  assert.deepEqual(queueGuards({ contact, touch, settings, draft: 'x', dueDate: '2026-10-27', now }), []);
});

test('daily cap counts queued sends on the local send day', () => {
  const queue = {
    'q1': { status: 'queued', sendAt: '2026-10-22T11:30:00Z' },
    'q2': { status: 'queued', sendAt: '2026-10-22T11:33:00Z' },
    'q3': { status: 'sent', sendAt: '2026-10-22T11:36:00Z' },
    'q4': { status: 'queued', sendAt: '2026-10-23T11:30:00Z' },
  };
  assert.equal(countQueuedOnDay(queue, '2026-10-22', 'America/New_York'), 2);
  assert.match(queueGuards({ contact, touch, settings, draft: 'x', dueDate: '2026-10-22', now, queue })[0], /daily cap of 2/);
  assert.deepEqual(queueGuards({ contact, touch, settings, draft: 'x', dueDate: '2026-10-23', now, queue }), []);
});

test('already queued or sent refuses', () => {
  assert.match(queueGuards({ contact, touch, settings, draft: 'x', dueDate: '2026-10-22', now, queue: { 'a|t|1': { status: 'queued' } } })[0], /already queued/);
  assert.match(queueGuards({ contact, touch, settings, draft: 'x', dueDate: '2026-10-22', now, queue: { 'a|t|1': { status: 'sent' } } })[0], /already sent/);
});

test('email confidence parses "92%" and bare numbers', () => {
  assert.equal(emailConfidencePct('92%'), 92);
  assert.equal(emailConfidencePct(70), 70);
  assert.equal(emailConfidencePct(''), null);
});

// ---------- body ----------
test('bodies: paragraphs, escaped, opt-out line on both', () => {
  const b = bodiesFor('Hi Dana,\n\nSaw the <reqs>.\nOne line.');
  assert.ok(b.text.endsWith(OPT_OUT_LINE));
  assert.ok(b.html.includes('<p>Hi Dana,</p>'));
  assert.ok(b.html.includes('&lt;reqs&gt;.<br>One line.'));
  assert.ok(b.html.includes(OPT_OUT_LINE.replace(/"/g, '&quot;')));
});

test('tag values round-trip the touch id', () => {
  assert.equal(tagValue('acct-1|thr_2|3'), 'acct-1__thr_2__3');
  assert.equal(untagValue(tagValue('acct-1|thr_2|3')), 'acct-1|thr_2|3');
});

// ---------- webhook ----------
test('svix signature verifies and rejects tampering, bad secret, stale timestamp', () => {
  const raw = crypto.randomBytes(24);
  const secret = 'whsec_' + raw.toString('base64');
  const id = 'msg_1', timestamp = String(Math.floor(Date.now() / 1000)), body = '{"type":"email.sent"}';
  const sig = 'v1,' + crypto.createHmac('sha256', raw).update(`${id}.${timestamp}.${body}`).digest('base64');
  assert.equal(verifySvix({ secret, id, timestamp, signature: sig, body }), true);
  assert.equal(verifySvix({ secret, id, timestamp, signature: 'v1,abc ' + sig, body }), true, 'any matching entry passes');
  assert.equal(verifySvix({ secret, id, timestamp, signature: sig, body: body + ' ' }), false);
  assert.equal(verifySvix({ secret: 'whsec_' + crypto.randomBytes(24).toString('base64'), id, timestamp, signature: sig, body }), false);
  assert.equal(verifySvix({ secret, id, timestamp: String(Number(timestamp) - 3600), signature: sig, body }), false);
});

test('event → status, and statuses only move forward', () => {
  assert.equal(statusForEvent('email.sent'), 'sent');
  assert.equal(statusForEvent('email.opened'), null);
  assert.equal(advanceStatus('queued', 'sent'), 'sent');
  assert.equal(advanceStatus('delivered', 'sent'), 'delivered');
  assert.equal(advanceStatus('cancelled', 'sent'), 'cancelled');
  assert.equal(advanceStatus('sent', 'bounced'), 'bounced');
});
