// ENGINE 7 LITE — pure outbound-message logic: sender resolution, soft angle
// classification, banned-word scrubbing, micro-copy gates, and prompt assembly.
// Deliberately free of I/O (no KV, no fetch) so it can be unit-tested directly.
// api/write.js wires this to auth, the monthly quota, and the Anthropic call.
//
// The quantitative rules below — the 25-75 word band, the 3rd-5th grade reading
// level, 1-3 word lowercase subject lines, interest-based CTAs, the signal
// durability split, and the staffing/AVL positioning — come from
// "The Science and Evolution of High-Converting B2B Outbound" (Master Report),
// which is also where the 9-point adversarial audit (Engine 7C) is specified.
// Two numbers from it are worth keeping in view while editing this file:
// an interest-based CTA converts near 37% against ~15% for a time-based ask,
// and response rates fall off a cliff past 75 words.

// ---------- sender identity (also re-exported from _lib.js) ----------
export const DEFAULT_SENDER_INTRO = 'I run a team focused on adding engineering capacity without unnecessary overhead.';
export const DEFAULT_ASSET = 'Capacity Map';

// Normalize a sender payload (accepts request-shape `senderName` or stored
// `name`) into the canonical stored shape, applying safe defaults. `name` is
// left blank if not provided — callers decide whether to require it.
export function normalizeSender(input) {
  input = input || {};
  const clip = (v, n) => (v == null ? '' : String(v)).trim().slice(0, n);
  return {
    name: clip(input.senderName != null ? input.senderName : input.name, 80),
    intro: clip(input.senderIntro != null ? input.senderIntro : input.intro, 280) || DEFAULT_SENDER_INTRO,
    company: clip(input.senderCompany != null ? input.senderCompany : input.company, 120),
    credibility: clip(input.senderCredibility != null ? input.senderCredibility : input.credibility, 240),
    defaultAsset: clip(input.defaultAsset, 60) || DEFAULT_ASSET,
  };
}

// "Help"/"helping" is a banned word; scrub it from user-provided sender copy
// before we inject it so a stored intro can't smuggle it into the draft.
export function scrubHelp(s) {
  return String(s || '')
    .replace(/\bhelping\b/gi, 'working with')
    .replace(/\bhelps\b/gi, 'works with')
    .replace(/\bhelp\b/gi, 'support');
}

// ---------- quota ----------
export const FREE_AI_PER_MONTH = 25;
// Copy shown when the free monthly quota is exhausted (unified $11/month pricing).
export function quotaExceededMessage() {
  return 'You’ve used your ' + FREE_AI_PER_MONTH + ' free outreaches. It’s $11/month for unlimited AI drafting — no card required to start.';
}

// ---------- channel spec + hard length limits (Engine 7 Lite LENGTH RULES) ----------
export const CHANNELS = {
  li:   'CHANNEL = LinkedIn. No subject line. A connection note or a short DM — context-driven, one question, no pitch pasted into a text box.',
  em:   'CHANNEL = Email. Start with one short "Subject:" line: 1-3 words, lowercase, written the way a colleague inside their company would title it. Then the body, in 1-2 sentence blocks separated by blank lines. Plain text only. Sign off with the sender\'s name.',
  call: 'CHANNEL = a spoken call opener + a short voicemail. The opener is the 27-second permission open: who is calling, one line on why, then hand control back to them. The voicemail runs 15-20 seconds and asks for nothing — it references the email and says the detail is in writing. Written the way the sender would actually say it out loud.',
};

export const TOUCH = {
  1: 'First touch — no prior contact. Cold open straight on their signal/observation. One observation, one problem, one proof point, one asset ask.',
  2: 'Follow-up — a prior touch went unanswered. Do NOT guilt-trip or say "just following up." Lead with a fresh observation or angle, still close on the asset CTA.',
  3: 'Third touch — shorter than before. Open on one new, useful angle.',
  4: 'Fourth touch — deliver the un-gated asset or the peer metric itself. Persistent but respectful and warm, still an asset-based close.',
  5: 'Final touch — the clean breakup, and the shortest thing the sender writes all week. Close on a No-oriented question the prospect can end by saying "no" ("Have you shelved this for the quarter?", "Is this off the table until next year?"). Never guilt, never one last pitch.',
};

/* ---------- MICRO-COPY LAW: the word band ----------
   Peak response sits at 25-75 words, with a steep drop past 125 and under half
   the response rate past 200. The ceiling belongs to the CHANNEL; the tighter
   budgets belong to the TOUCH, from the sprint spec — touch 1 is a cold open
   and the last touch is a breakup, which should be the shortest of all.

   Counted on the BODY only: an email's "Subject:" line is not part of it. */
export const WORD_BUDGET = {
  em:   { min: 25, max: 75 },
  li:   { min: 15, max: 75 },
  call: { min: 30, max: 140 },   // opener + voicemail together, spoken
};
export const TOUCH_WORDS = { 1: [25, 65], 2: [30, 55], 3: [25, 50], 4: [35, 50], 5: [25, 45] };

// The budget actually in force: the channel ceiling, tightened by the touch.
// A spoken draft carries two scripts in one answer, so it keeps the channel band.
export function wordBudget(channel, step) {
  const ch = WORD_BUDGET[channel] || WORD_BUDGET.li;
  const t = TOUCH_WORDS[step];
  if (channel === 'call' || !t) return { min: ch.min, max: ch.max };
  return { min: Math.max(ch.min, t[0]), max: Math.min(ch.max, t[1]) };
}

export function countWords(s) {
  const t = String(s || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

// ENGINE 7 LITE — Message Writer system prompt. Never returned to the client.
export const SYSTEM = [
  'You are ENGINE 7 LITE — the outbound message writer for VAMOS. You write a single high-conversion message on behalf of the SENDER described in each request, using the Engine 7 methodology even when full account/contact research is unavailable. You never write generic outreach — you enforce the structure below.',
  '',
  'WHO THE SENDER IS: given in the SENDER block of each request (name, sender line, optional credibility). Introduce the sender using ONLY that block — never invent a name, title, employer, or backstory, and never substitute your own.',
  '',
  'MICRO-COPY LAW — this is read on a phone, in about eleven seconds, between two meetings. It is scanned, not read. The scan goes: sender and subject, first sentence, the shape of the body, the last line. Dense paragraphs are skipped before they are understood.',
  '· LENGTH: the body lands inside the word band named in the request. Past 75 words response rates fall off a cliff. Say what the message needs and stop.',
  '· READING LEVEL: 3rd-5th grade. Short words, short sentences, no corporate register. "We mapped 14 engineers with that stack" beats "we have conducted a comprehensive talent landscape analysis".',
  '· BLOCKS: 1-2 sentences per paragraph, blank line between them. Never a wall.',
  '· PLAIN TEXT: no HTML, no banners, no tracked links, no emoji, no exclamation marks.',
  '· ONE IDEA: one observation, one problem, one ask. A second value proposition erases the first.',
  '',
  'SUBJECT LINE (email only): 1-3 words, lowercase, the way a colleague inside their company would title it — "ramp time at Acme", "open staff data role", "q3 capacity". Never title case, never a pitch, never punctuation for effect.',
  '',
  'CORE STRUCTURE — NON-NEGOTIABLE. Every message follows this exact order:',
  '1. THEM FIRST — open with a specific observation about the prospect, their company, team, role, or a provided signal. Never open with "I wanted to reach out," with the sender\'s title, or with a pitch.',
  '2. BRIEF SENDER LINE — one short bridge line introducing the sender, taken from the SENDER block. Brief. Not a pitch.',
  '3. BACK TO THEM, WITH CURIOSITY — a genuine question or curious observation tied to their likely priority, pressure, or signal. Curiosity is the close, not a pitch.',
  '4. ASSET-BASED CTA — end with ONE clear yes/no ask tied to a useful asset (prefer the request\'s PREFERRED ASSET). This is always the final line.',
  '',
  'THE 1+3 (infer silently — never expose the analysis): THE 1 = one dated, specific, checkable observation about them. THE 3 = (a) an operational cost or latency point, (b) a peer outcome, (c) a diagnostic insight that only follows from their signal. Use them to shape the message; never print them as a list.',
  '',
  'PROOF DISCIPLINE — the hard limit on all of the above: never invent a benchmark, a peer company, a percentage, a headcount, a timeline, or a case study. Use only what the request gives you — the SIGNAL / NOTES and the sender\'s credibility line. When there is no verified proof point, carry the message on the observation and the diagnostic insight alone. A fabricated number is worse than no number: it is the one mistake the prospect can check.',
  '',
  'ASSET-BASED CTA — every message offers a useful artifact before asking for any time. Assets: Talent Map, Blueprint, Cost Analysis, Capacity Map, Hiring Signal Map, Role Gap Analysis. Approved CTA phrasings: "Want me to send it over?", "Should I send it over?", "Worth sending your way?", "Want the quick version?", "Should I send the map?", "Want me to share the Blueprint?". The primary CTA is NEVER a meeting or call request.',
  '',
  'WHY THE ASSET ASK, NOT THE MEETING: an interest-based ask ("open to reviewing it?") converts to a meeting near 37%; a time-based ask ("30 minutes Thursday?") lands near 15%. Asking for time first triggers reactance — the reader defends their calendar instead of reading the idea. Offer the artifact; the meeting is what happens next, not what you ask for.',
  '',
  'AUTONOMY: never presume a slot, never paste a calendar link, never ask for a yes the reader has no reason to give yet. On the final touch, close with a No-oriented question — one they can end by saying "no" ("Have you shelved this for the quarter?"). Giving them the easy out is what earns the honest answer.',
  '',
  'BANNED WORDS — never use: Hope, Help, Check-in, Synergy, Thought, Connect, Revolutionary, Disruptive. BANNED PHRASES — never use: "just reaching out", "might be worth", "no pressure", "wanted to reach out", "pick your brain", "circle back", "let me know", "thoughts?", "would love to connect", "are you open to a call", "can we meet", "I hope this finds you well", "quick call", "touching base", "top of mind". No emoji, no exclamation-mark hype.',
  '',
  'STYLE: minimalist, editorial, high-authority, human, confident, specific. No fluff, no generic openers.',
  '',
  'SIGNAL DURABILITY — not every fact is news. A PERISHABLE signal (a role open past 45 days, a new VP in the last 90, a funding round, a stack migration) is worth about six months and is the LEAD hook: open on it. A DURABLE signal (a stated operating philosophy, a standing cost mandate, a re-shoring position) lasts a year or more and is NEVER presented as breaking news — it is a bridge, used after the opener: "you already work this way, which is why X is odd". Presenting a durable fact as fresh is the tell that nobody actually looked.',
  '',
  'STAFFING & NEARSHORE RULES — this sender sells capacity, not software, and the reader gets a dozen identical agency pitches a week:',
  '· STALLED REQUISITION (open 45+ days): anchor on lost delivery velocity and the specific stack, never on recruiting as a service. A role stalls because the profile is scarce, not because they lack a recruiter — say the scarce thing by name.',
  '· CANDIDATE-LED (MPC): never paste or attach a full resume. Three anonymized bullets — what they shipped, exact stack, availability — and offer the profile summary as the asset.',
  '· APPROVED VENDOR LISTS / MSP / VMS: never position against internal talent acquisition or the incumbent vendor. Position as the specialist for what has stayed unfilled past day 30-45.',
  '· NEARSHORE: timezone overlap first, cultural parity second, cost third — and acknowledge what they already run onshore before naming what is missing.',
  '',
  'INTEL RULE: use whatever is provided (name, company, title, signal, prior relationship, notes). Treat provided intel as user-provided / unverified — use it carefully, never overclaim, never fabricate. Obey the SIGNAL STRENGTH mode in the request: STRONG = open specifically and confidently on the signal; THIN = open with careful, hedged language ("looks like", "appears"); NONE = open from their role or company generally and invent no specifics.',
  '',
  'PRIOR RELATIONSHIP: if the request names a prior relationship with the account, do NOT lead with it. Lead with the prospect/company signal first, then use the prior relationship as credibility after the opening observation.',
  '',
  'OUTPUT: return ONLY the finished message — no analysis, no scoring, no alternate versions, no quotation marks around it, no preamble.',
  '',
  'QUALITY CHECK before returning — nine gates, and any NO is a rewrite, not a ship: (1) every claim traces to something the request actually gave you · (2) the body is inside the word band · (3) it reads at 3rd-5th grade · (4) no banned word or phrase · (5) email subject is 1-3 lowercase words · (6) the CTA is interest-based, asset-based, and the final line · (7) plain text, 1-2 sentence blocks · (8) it opens about them, with a brief sender line in the provided identity · (9) nothing invented — no sender name, no metric, no peer, no signal.',
].join('\n');

// ---------- audit (Engine 8 § 6, the decidable half) ----------
// The QUALITY CHECK above is an instruction, and a model marking its own
// homework passes itself on length and banned words more often than it should.
// These are the checks that need no judgement, so they are made here instead of
// asked for. A failure is fed back verbatim for one rewrite — per the ŌLLIN
// Systems Engine 8 rule that any NO is a rewrite, not a ship.

// Everything SYSTEM already bans, plus the Engine 8 list. Lower-case; matched
// as substrings against the lower-cased draft.
export const BANNED_STRINGS = [
  // Engine 7 Lite's own list
  'check-in', 'synergy', 'just reaching out', 'might be worth', 'no pressure',
  'wanted to reach out', 'pick your brain', 'circle back', 'let me know',
  'would love to connect', 'are you open to a call', 'can we meet',
  'i hope this finds you well',
  // Engine 8 § 4
  'leverage', 'robust', 'seamless', 'landscape', 'circling back',
  'reaching out', 'at the end of the day', "in today's", 'game-changer',
  'deep dive', 'unlock', 'empower', 'journey', 'excited to',
  'talent solutions', 'talent needs', 'best-in-class', 'world-class',
  'top-tier talent', 'quick question', 'following up', 'touching base',
  // Master Report additions
  'quick call', 'top of mind', 'reach out', 'per my last',
];

/* Words the report bans outright, which are too short to match as substrings
   without catching innocent text ('hope' inside 'hopeful' is fine to catch;
   'connect' inside 'connected' is not, and 'thought' inside 'thoughtful' is a
   different word). Matched on word boundaries instead. */
export const BANNED_WORDS = [
  'hope', 'hopes', 'hoping', 'thought', 'thoughts', 'connect', 'connecting',
  'revolutionary', 'disruptive', 'synergies',
];

// A meeting ask is never the primary CTA — SYSTEM says so, this proves it.
const MEETING_ASKS = [
  'do you have 15 minutes', 'hop on a call', 'book a time', 'grab time',
  'find a time', 'schedule a call', 'on my calendar', 'your calendar',
  '15 min', '15-min', '30 minutes',
];

/* ---------- readability ----------
   Flesch-Kincaid grade level. The standard is 3rd-5th grade, and SYSTEM asks
   for exactly that — but the gate cannot sit at 5, because the vocabulary this
   sender is paid to use inflates the score no matter how plain the sentences
   around it are. Measured on the report's own high-converting exemplars:

     stalled-requisition email .......... 11.8
     candidate-profile (MPC) email ...... 10.8
     contractor-surge email ............. 11.1
     a wall of corporate prose .......... 32.5
     plain copy, short sentences ......... 4.2

   So the prompt aims at 5 and the gate fires at 14: high enough that
   "Snowflake pipeline experience" is never the reason a good draft is rewritten,
   low enough that the corporate register never survives. */
export const FK_GATE = 14;

function syllables(word) {
  const w = String(word).toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w
    .replace(/(?:es|ed|[^laeiouy]e)$/, '')
    .match(/[aeiouy]{1,2}/g);
  return groups ? groups.length : 1;
}

export function fkGrade(text) {
  const t = String(text || '').trim();
  if (!t) return 0;
  const words = t.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  if (!words.length) return 0;
  /* A bullet and a hard line break each end a unit of reading as surely as a
     full stop does. Counting only terminators scored a 3-bullet capability
     summary as one 53-word sentence, which is not how anybody reads it. */
  const byStop = t.split(/[.!?]+(?:\s|$)/).filter((x) => x.trim()).length;
  const byLine = t.split(/\n+/).filter((x) => x.trim()).length;
  const sentences = Math.max(byStop, byLine, 1);
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  return 0.39 * (words.length / sentences) + 11.8 * (syl / words.length) - 15.59;
}

/* Paragraph blocks. The standard is 1-2 sentences per block; the gate fires at
   4, which is squarely in the "dense block, gets skipped" range the report
   measures, so a three-sentence block is a nudge in the prompt rather than a
   forced rewrite. Bullet lists (the MPC capability summary) are exempt. */
export function denseBlocks(body, limit) {
  const cap = limit || 4;
  return String(body || '')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .filter((b) => !/^[-•*\d]/.test(b))
    .filter((b) => b.split(/[.!?]+(?:\s|$)/).filter((x) => x.trim()).length >= cap)
    .length;
}

// Email drafts open with a "Subject:" line; the body is what has the limit.
export function splitSubject(text) {
  const match = String(text || '').match(/^\s*Subject:\s*(.+?)\s*\n([\s\S]*)$/i);
  if (!match) return { subject: '', body: String(text || '').trim() };
  return { subject: match[1].trim(), body: match[2].trim() };
}

// Returns [] when the draft is shippable, otherwise one plain sentence per
// failure — written to be handed straight back to the model. `step` is the
// touch number, which decides the word budget; it is optional and falls back
// to the channel band.
export function auditDraft(text, channel, step) {
  const draft = String(text || '').trim();
  if (!draft) return ['The draft is empty.'];

  const failures = [];
  const { subject, body } = channel === 'em' ? splitSubject(draft) : { subject: '', body: draft };
  const haystack = draft.toLowerCase();

  if (channel === 'em' && !subject) {
    failures.push('The email is missing its "Subject:" first line.');
  }

  const hits = BANNED_STRINGS.filter((phrase) => haystack.includes(phrase));
  if (hits.length) failures.push('Banned wording used: ' + hits.join(', ') + '.');

  const words = BANNED_WORDS.filter((w) => new RegExp('\\b' + w + '\\b', 'i').test(draft));
  if (words.length) failures.push('Banned wording used: ' + words.join(', ') + '.');

  // "help" family is scrubbed from sender copy; it must not come back in the draft.
  if (/\bhelp(s|ing|ed)?\b/i.test(draft)) {
    failures.push('Uses the banned word "help".');
  }

  const meeting = MEETING_ASKS.filter((phrase) => haystack.includes(phrase));
  if (meeting.length) {
    failures.push('Asks for a meeting (' + meeting.join(', ') + '); the CTA must be asset-based.');
  }

  /* The word band. Over the ceiling is the failure the report is loudest
     about, so it is stated as a instruction to cut rather than a complaint. */
  const band = wordBudget(channel, step);
  const n = countWords(body);
  if (n > band.max) {
    failures.push(
      'The body runs ' + n + ' words; the budget for this touch is ' + band.min + '-' + band.max +
      '. Cut it to under ' + band.max + ' without losing the observation or the ask.'
    );
  } else if (n && n < band.min) {
    failures.push(
      'The body is only ' + n + ' words; this touch needs ' + band.min + '-' + band.max +
      ' to carry an observation, a problem and an ask.'
    );
  }

  // Subject line: 1-3 lowercase words. Four is let through; five is a headline.
  if (channel === 'em' && subject) {
    const sw = countWords(subject);
    if (sw > 5) {
      failures.push('The subject line is ' + sw + ' words; it should read like an internal note, 1-3 words.');
    }
    if (subject === subject.toUpperCase() && /[A-Z]/.test(subject)) {
      failures.push('The subject line is in capitals; it should be lowercase.');
    }
    if (/[!?]/.test(subject)) {
      failures.push('The subject line uses ! or ?; it should be a flat internal-style label.');
    }
  }

  const grade = fkGrade(body);
  if (grade > FK_GATE) {
    failures.push(
      'It reads at about grade ' + grade.toFixed(1) + '; the target is grade 5. ' +
      'Shorten the sentences and swap the corporate words for plain ones.'
    );
  }

  const dense = denseBlocks(body);
  if (dense) {
    failures.push(
      dense + ' paragraph' + (dense === 1 ? ' is' : 's are') + ' too dense to scan; ' +
      'keep each block to 1-2 sentences with a blank line between them.'
    );
  }

  const emDashes = (draft.match(/—/g) || []).length;
  if (emDashes > 1) failures.push(emDashes + ' em dashes; the maximum is one.');

  return failures;
}

// The rewrite instruction, given what failed.
export function rewritePrompt(failures) {
  return (
    'That draft failed its own quality check:\n' +
    failures.map((f) => '- ' + f).join('\n') +
    '\n\nRewrite it. Same sender, same prospect, same angle, same structure. ' +
    'Fix every line above and change nothing else that was working. Return only the message.'
  );
}

// Draft angle frame — the three tabs in the brief UI (THE GAP / COST OF
// WAITING / THE PERSON). Each steers the same Engine 7 structure toward a
// different argument without changing the rules (banned words, CTA, length).
export const ANGLE_FRAMES = {
  gap: 'ANGLE FRAME: THE GAP. Center the opening observation on the specific capability or role gap at their company right now.',
  cow: 'ANGLE FRAME: COST OF WAITING. Center the opening observation on what leaving that gap open is costing them — time, risk, or a missed window — not just that the gap exists.',
  person: 'ANGLE FRAME: THE PERSON. Center the opening observation on the prospect specifically — their move, their team, their own stake in this — rather than the company in the abstract.',
};
export function normAngleFrame(f) { return ANGLE_FRAMES[f] ? f : 'gap'; }

/* Signal durability (Master Report § signal taxonomy). Perishable signals are
   news and lead the message; durable ones are standing facts and may only be
   used as a bridge after the opener. The client may say which it is; when it
   does not, a signal is treated as perishable, which is how it reads. */
export const DURABILITY = {
  perishable: 'SIGNAL DURABILITY: PERISHABLE. This is news — a stalled role, a new leader, a raise, a migration. Lead with it in the first line.',
  durable:    'SIGNAL DURABILITY: DURABLE. This is a standing fact about how they operate, not news. Do NOT open on it as though you just noticed it. Open on the prospect or their role, then use this as the bridge: they already work this way, which is what makes the gap worth naming.',
};
export function normDurability(d) { return DURABILITY[d] ? d : 'perishable'; }

// SIGNAL STRENGTH mode instructions, keyed by classified angle strength.
export const SIGNAL_MODE = {
  strong: 'SIGNAL STRENGTH: STRONG. Open confidently and specifically on the signal/notes below.',
  thin:   'SIGNAL STRENGTH: THIN. The signal is weak or unverified — open with careful, hedged language ("looks like", "appears", "noticed"). State nothing as certain; do not overclaim.',
  missing:'SIGNAL STRENGTH: NONE. No specific signal is available — open from their role or company in general terms. Do NOT invent specifics, metrics, events, or quotes; draw curiosity from their likely priorities, not fabricated facts.',
};

// Classify the provided angle: MISSING (no signal) / THIN (weak, client-flagged
// via angleStrength) / STRONG (default when a signal is provided).
export function classifyAngle(angle, angleStrengthHint) {
  if (!angle) return 'missing';
  return String(angleStrengthHint || '').toLowerCase() === 'thin' ? 'thin' : 'strong';
}

// Client-facing hint for weak/absent signals (null when the signal is strong).
export function angleWarningFor(strength) {
  if (strength === 'missing') return 'No signal provided — opened on their role and company. Add a specific signal for a sharper first line.';
  if (strength === 'thin') return 'Weak signal — the opener stays careful and hedged. A concrete detail will sharpen it.';
  return null;
}

// Resolve the sender identity: request keys → stored profile (user.sender) →
// normalizeSender defaults (intro + asset filled; name may stay blank).
export function resolveSender(user, body) {
  user = user || {};
  body = body || {};
  return normalizeSender({
    name: body.senderName != null ? body.senderName : (user.sender && user.sender.name),
    intro: body.senderIntro != null ? body.senderIntro : (user.sender && user.sender.intro),
    company: body.senderCompany != null ? body.senderCompany : (user.sender && user.sender.company),
    credibility: body.senderCredibility != null ? body.senderCredibility : (user.sender && user.sender.credibility),
    defaultAsset: body.defaultAsset != null ? body.defaultAsset : (user.sender && user.sender.defaultAsset),
  });
}

// Pure prompt builder. Returns everything write.js needs to make the call and
// respond: the resolved channel/step, the system prompt, the user prompt, and
// the client-facing angleWarning. No I/O.
export function buildDraftPrompt(user, body) {
  body = body || {};
  const name = (body.name || '').toString().slice(0, 120) || 'there';
  const title = (body.title || '').toString().slice(0, 160);
  const company = (body.company || '').toString().slice(0, 160) || 'their company';
  const channel = CHANNELS[body.channel] ? body.channel : 'li';
  const step = Math.min(5, Math.max(1, parseInt(body.step, 10) || 1));
  const steer = (body.steer || '').toString().slice(0, 240).trim();
  const angle = (body.angle || '').toString().slice(0, 400).trim();
  const priorRel = (body.priorRelationshipNotes != null ? body.priorRelationshipNotes : (body.priorRelationship || '')).toString().slice(0, 300).trim();

  const sender = resolveSender(user, body);
  const senderIntro = scrubHelp(sender.intro);
  const senderCred = scrubHelp(sender.credibility);
  // Dynamic sender line — never "I'm —": drop the name clause if there's no name.
  const senderLine = sender.name ? ('I’m ' + sender.name + ' — ' + senderIntro) : senderIntro;

  const strength = classifyAngle(angle, body.angleStrength);
  const angleWarning = angleWarningFor(strength);
  const angleFrame = normAngleFrame(body.angleFrame);
  const durability = normDurability(body.signalDurability);
  const band = wordBudget(channel, step);

  const prompt =
    CHANNELS[channel] + '\n\n' +
    'PROSPECT: ' + name + (title ? ', ' + title : '') + ' at ' + company + '.\n\n' +
    'SENDER — introduce them in the brief sender line; never invent a name, title, or backstory:\n' +
    (sender.name ? '  Name: ' + sender.name + '\n' : '  (No name provided — introduce without a name, using the sender line as-is.)\n') +
    '  Sender line to use (you may lightly rephrase ONLY to obey the banned-word rules): ' + senderLine + '\n' +
    (senderCred ? '  Credibility (supporting proof only — never the opener): ' + senderCred + '\n' : '') +
    '\n' +
    SIGNAL_MODE[strength] + '\n' +
    (angle ? DURABILITY[durability] + '\n' : '') +
    (angleFrame !== 'gap' ? ANGLE_FRAMES[angleFrame] + '\n' : '') +
    (angle ? 'SIGNAL / NOTES (user-provided, unverified — weave in naturally, do not quote): ' + angle + '\n' : '') +
    (priorRel ? 'PRIOR RELATIONSHIP (use as credibility AFTER the prospect-first opener — never lead with it): ' + priorRel + '\n' : '') +
    'PREFERRED ASSET for the CTA: ' + sender.defaultAsset + '. Build the final asset-based CTA around it (e.g. "I built a quick ' + sender.defaultAsset + ' around this — should I send it over?"). Never make the CTA a meeting or call request.\n' +
    (TOUCH[step] || '') + '\n' +
    (steer ? 'DIRECTION / TONE from the sender (follow it while keeping every rule above): ' + steer + '\n' : '') +
    'WORD BUDGET for this touch: ' + band.min + '-' + band.max + ' words in the body' +
      (channel === 'em' ? ' (the "Subject:" line does not count)' : '') +
      '. ' + band.max + ' is a ceiling, not a target — under it is better than at it.\n' +
    '\nWrite the single message now, following the Engine 7 structure and the word budget exactly. Return only the message.';

  return { channel, step, system: SYSTEM, prompt, angleWarning, angleStrength: strength, durability, band };
}
