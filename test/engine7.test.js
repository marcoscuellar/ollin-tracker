// Deterministic unit tests for the pure ENGINE 7 LITE logic in api/engine7.js.
// No network, no KV, no API key — imports the real module and asserts on the
// prompt/sender/angle output. Run with: npm test   (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDraftPrompt, resolveSender, quotaExceededMessage,
  SYSTEM, DEFAULT_SENDER_INTRO, DEFAULT_ASSET,
} from '../api/engine7.js';

const PROFILE = {
  sender: { name: 'Ana Reyes', intro: 'I run a team that adds senior engineers.', company: 'Northstar', credibility: 'Placed 40 engineers last year.', defaultAsset: 'Talent Map' },
};

// --- sender resolution priority: request → profile → fallback ---------------
test('sender resolution: request overrides profile', () => {
  const s = resolveSender(PROFILE, { senderName: 'Requested', senderIntro: 'Req intro.', defaultAsset: 'Blueprint' });
  assert.equal(s.name, 'Requested');
  assert.equal(s.intro, 'Req intro.');
  assert.equal(s.defaultAsset, 'Blueprint');
});

test('sender resolution: falls back to profile when request omits fields', () => {
  const s = resolveSender(PROFILE, {});
  assert.equal(s.name, 'Ana Reyes');
  assert.equal(s.intro, 'I run a team that adds senior engineers.');
  assert.equal(s.defaultAsset, 'Talent Map');
});

test('sender resolution: falls back to defaults when neither request nor profile set', () => {
  const s = resolveSender({}, {});
  assert.equal(s.name, '');                       // no name anywhere
  assert.equal(s.intro, DEFAULT_SENDER_INTRO);
  assert.equal(s.defaultAsset, DEFAULT_ASSET);
});

// --- no hardcoded Marcos (unless the sender genuinely resolves to Marcos) ----
test('no hardcoded Marcos in SYSTEM or in a default-sender prompt', () => {
  assert.ok(!/Marcos/i.test(SYSTEM), 'SYSTEM must not name Marcos');
  const { prompt } = buildDraftPrompt({}, { name: 'Sam', company: 'Acme' });
  assert.ok(!/Marcos/i.test(prompt), 'default-sender prompt must not name Marcos');
});

test('Marcos appears only when the resolved sender is actually named Marcos', () => {
  const { prompt } = buildDraftPrompt({ sender: { name: 'Marcos', intro: 'x' } }, {});
  assert.ok(prompt.includes('Marcos'), 'a Marcos sender should appear in the prompt');
});

// --- never outputs "I'm —" ---------------------------------------------------
test('no-name sender never produces an empty "I’m —" line', () => {
  const { prompt } = buildDraftPrompt({}, {});
  assert.ok(!prompt.includes('I’m —'), 'must not contain "I’m —"');
  assert.ok(!prompt.includes("I'm —"), 'must not contain "I\'m —"');
  // the sender line is just the intro, with no "I’m" prefix at all
  assert.ok(prompt.includes('Sender line to use (you may lightly rephrase ONLY to obey the banned-word rules): ' + DEFAULT_SENDER_INTRO));
});

test('named sender produces a proper "I’m [name] — [intro]" line', () => {
  const { prompt } = buildDraftPrompt({ sender: { name: 'Ana', intro: 'I run a team.' } }, {});
  assert.ok(prompt.includes('I’m Ana — I run a team.'));
});

// --- help/helps/helping scrubbed from sender intro ---------------------------
test('help / helps / helping are scrubbed from the injected sender copy', () => {
  const { prompt } = buildDraftPrompt({}, {
    senderName: 'Bo',
    senderIntro: 'I help teams; she helps daily; helping always.',
    senderCredibility: 'We help brands scale.',
  });
  assert.ok(!/\bhelp(s|ing)?\b/i.test(prompt), 'no standalone help/helps/helping in prompt');
});

// --- default / preferred asset flows through ---------------------------------
test('default asset flows into the CTA instruction (fallback, profile, request)', () => {
  assert.ok(buildDraftPrompt({}, {}).prompt.includes('PREFERRED ASSET for the CTA: ' + DEFAULT_ASSET));
  assert.ok(buildDraftPrompt(PROFILE, {}).prompt.includes('PREFERRED ASSET for the CTA: Talent Map'));
  assert.ok(buildDraftPrompt(PROFILE, { defaultAsset: 'Cost Analysis' }).prompt.includes('PREFERRED ASSET for the CTA: Cost Analysis'));
});

// --- prior relationship instruction appears AFTER the prospect-first content -
test('prior relationship instruction appears after the prospect-first opener', () => {
  const { prompt } = buildDraftPrompt(PROFILE, { name: 'Sam', company: 'Acme', angle: 'posted roles', priorRelationshipNotes: 'we met at Re:Invent' });
  const priorIdx = prompt.indexOf('PRIOR RELATIONSHIP');
  assert.ok(priorIdx > -1, 'prior relationship line present');
  assert.ok(prompt.includes('use as credibility AFTER the prospect-first opener — never lead with it'));
  // must come after the prospect line and the sender block (i.e. not lead)
  assert.ok(priorIdx > prompt.indexOf('PROSPECT:'), 'prior relationship after the prospect line');
  assert.ok(priorIdx > prompt.indexOf('SENDER — introduce them'), 'prior relationship after the sender block');
});

test('no prior-relationship line when none is provided', () => {
  const { prompt } = buildDraftPrompt(PROFILE, { angle: 'x' });
  assert.ok(!prompt.includes('PRIOR RELATIONSHIP'));
});

// --- soft angle handling: missing / thin / strong ----------------------------
test('missing angle produces an angleWarning and a NONE signal mode', () => {
  const r = buildDraftPrompt(PROFILE, {}); // no angle
  assert.equal(r.angleStrength, 'missing');
  assert.ok(typeof r.angleWarning === 'string' && /no signal/i.test(r.angleWarning));
  assert.ok(r.prompt.includes('SIGNAL STRENGTH: NONE'));
  assert.ok(r.prompt.includes('Do NOT invent specifics'));
});

test('thin angle produces careful/hedged-language instruction + warning', () => {
  const r = buildDraftPrompt(PROFILE, { angle: 'maybe hiring', angleStrength: 'thin' });
  assert.equal(r.angleStrength, 'thin');
  assert.ok(typeof r.angleWarning === 'string' && r.angleWarning.length > 0);
  assert.ok(r.prompt.includes('SIGNAL STRENGTH: THIN'));
  assert.ok(/hedged|careful|"looks like"/.test(r.prompt), 'thin mode instructs careful language');
});

test('strong angle has no warning and a STRONG signal mode', () => {
  const r = buildDraftPrompt(PROFILE, { angle: 'posted 3 backend roles' });
  assert.equal(r.angleStrength, 'strong');
  assert.equal(r.angleWarning, null);
  assert.ok(r.prompt.includes('SIGNAL STRENGTH: STRONG'));
});

// --- 402 quota copy uses the unified $11/month language ----------------------
test('402 quota copy uses unified $11/month pricing, not founding-member copy', () => {
  const msg = quotaExceededMessage();
  assert.ok(msg.includes('$11/month'));
  assert.ok(/no card required to start/i.test(msg));
  assert.ok(!/founding/i.test(msg));
});

// --- Engine 7 Lite structure preserved: them → sender → curiosity → asset CTA -
test('SYSTEM enforces the them → sender → curiosity → asset-CTA order', () => {
  const i1 = SYSTEM.indexOf('1. THEM FIRST');
  const i2 = SYSTEM.indexOf('2. BRIEF SENDER LINE');
  const i3 = SYSTEM.indexOf('3. BACK TO THEM, WITH CURIOSITY');
  const i4 = SYSTEM.indexOf('4. ASSET-BASED CTA');
  assert.ok(i1 > -1 && i2 > i1 && i3 > i2 && i4 > i3, 'four structure steps present and in order');
});

// --- CTA is asset-based, never a meeting ------------------------------------
test('CTA is asset-based, never a meeting/call request', () => {
  assert.ok(SYSTEM.includes('The primary CTA is NEVER a meeting or call request.'));
  const { prompt } = buildDraftPrompt(PROFILE, { angle: 'x' });
  assert.ok(prompt.includes('Never make the CTA a meeting or call request.'));
});
