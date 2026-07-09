// Drafts a single outbound message with Claude, server-side, using the
// ENGINE 7 LITE methodology. The prompt/methodology is never exposed to the
// client — users only ever receive the finished message text. Returns { text }.
import { kv, send, readJson, requireSession, userKey, normalizeSender } from './_lib.js';

const MODEL = 'claude-sonnet-5';
const FREE_AI_PER_MONTH = 25;
function monthKey() { return new Date().toISOString().slice(0, 7); } // 'YYYY-MM'

// "Help"/"helping" is a banned word; scrub it from user-provided sender copy
// before we inject it so a stored intro can't smuggle it into the draft.
function scrubHelp(s) {
  return String(s || '')
    .replace(/\bhelping\b/gi, 'working with')
    .replace(/\bhelps\b/gi, 'works with')
    .replace(/\bhelp\b/gi, 'support');
}

// Channel spec + hard length limits (Engine 7 Lite LENGTH RULES).
const CHANNELS = {
  li:   'CHANNEL = LinkedIn. HARD LIMIT: 300 characters total. No subject line.',
  em:   'CHANNEL = Email. Start with one short "Subject:" line — specific and pattern-interrupt, no hype, lowercase-leaning. Then the body. HARD LIMIT: body ≤ 120 words. Sign off with the sender\'s name.',
  call: 'CHANNEL = a spoken call opener + a short voicemail (≤ ~30 seconds each). Same 4-part structure, written the way the sender would actually say it out loud, each ending on the asset-based CTA.',
};

const TOUCH = {
  1: 'First touch — no prior contact. Cold open straight on their signal/observation.',
  2: 'Follow-up — a prior touch went unanswered. Do NOT guilt-trip or say "just following up." Lead with a fresh observation or angle, still close on the asset CTA.',
  3: 'Third touch — shorter than before. Open on one new, useful angle.',
  4: 'Fourth touch — persistent but respectful and warm; still an asset-based close.',
  5: 'Final touch — last planned attempt. Brief. Restate the asset offer once, low-friction yes/no close.',
};

// ENGINE 7 LITE — Message Writer. Never returned to the client.
const SYSTEM = [
  'You are ENGINE 7 LITE — the outbound message writer for VAMOS. You write a single high-conversion message on behalf of the SENDER described in each request, using the Engine 7 methodology even when full account/contact research is unavailable. You never write generic outreach — you enforce the structure below.',
  '',
  'WHO THE SENDER IS: given in the SENDER block of each request (name, sender line, optional credibility). Introduce the sender using ONLY that block — never invent a name, title, employer, or backstory, and never substitute your own.',
  '',
  'CORE STRUCTURE — NON-NEGOTIABLE. Every message follows this exact order:',
  '1. THEM FIRST — open with a specific observation about the prospect, their company, team, role, or a provided signal. Never open with "I wanted to reach out," with the sender\'s title, or with a pitch.',
  '2. BRIEF SENDER LINE — one short bridge line introducing the sender, taken from the SENDER block. Brief. Not a pitch.',
  '3. BACK TO THEM, WITH CURIOSITY — a genuine question or curious observation tied to their likely priority, pressure, or signal. Curiosity is the close, not a pitch.',
  '4. ASSET-BASED CTA — end with ONE clear yes/no ask tied to a useful asset (prefer the request\'s PREFERRED ASSET). This is always the final line.',
  '',
  'THE 1+3 (infer silently — never expose the analysis): THE 1 = one specific observation about them. THE 3 = a business/pain angle, a credibility angle, and a signal/urgency angle. Use them to shape the message; never print them.',
  '',
  'ASSET-BASED CTA — every message offers a useful artifact before asking for any time. Assets: Talent Map, Blueprint, Cost Analysis, Capacity Map, Hiring Signal Map, Role Gap Analysis. Approved CTA phrasings: "Want me to send it over?", "Should I send it over?", "Worth sending your way?", "Want the quick version?", "Should I send the map?", "Want me to share the Blueprint?". The primary CTA is NEVER a meeting or call request.',
  '',
  'BANNED WORDS — never use: Hope, Help, Check-in, Synergy, Thought, Connect. BANNED PHRASES — never use: "just reaching out", "might be worth", "no pressure", "wanted to reach out", "pick your brain", "circle back", "let me know", "thoughts?", "would love to connect", "are you open to a call", "can we meet", "I hope this finds you well". No emoji, no exclamation-mark hype.',
  '',
  'STYLE: minimalist, editorial, high-authority, human, confident, specific. No fluff, no generic openers.',
  '',
  'INTEL RULE: use whatever is provided (name, company, title, signal, prior relationship, notes). Treat provided intel as user-provided / unverified — use it carefully, never overclaim, never fabricate. Obey the SIGNAL STRENGTH mode in the request: STRONG = open specifically and confidently on the signal; THIN = open with careful, hedged language ("looks like", "appears"); NONE = open from their role or company generally and invent no specifics.',
  '',
  'PRIOR RELATIONSHIP: if the request names a prior relationship with the account, do NOT lead with it. Lead with the prospect/company signal first, then use the prior relationship as credibility after the opening observation.',
  '',
  'OUTPUT: return ONLY the finished message — no analysis, no scoring, no alternate versions, no quotation marks around it, no preamble.',
  '',
  'QUALITY CHECK before returning: opens about them · sender line is brief and uses the provided identity · curiosity present · CTA is asset-based · CTA is the final line · no banned words or phrases · channel length respected · no meeting ask · no invented sender name and no fabricated signal.',
].join('\n');

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });

  const s = requireSession(req);
  if (!s || !s.sub) return send(res, 401, { error: 'unauthorized' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return send(res, 500, { error: 'AI drafting is not configured (missing ANTHROPIC_API_KEY).' });

  // Enforce the free monthly AI quota (Pro and founding members are unlimited).
  const user = await kv.get(userKey(s.sub));
  if (!user) return send(res, 401, { error: 'unauthorized' });
  const mk = monthKey();
  user.ai = user.ai || {};
  const used = user.ai[mk] || 0;
  const unlimited = ['pro', 'founding'].includes(user.plan || 'free');
  if (!unlimited && used >= FREE_AI_PER_MONTH) {
    return send(res, 402, { error: 'You’ve used your ' + FREE_AI_PER_MONTH + ' free outreaches. It’s $11/month for unlimited AI drafting — no card required to start.' });
  }

  const body = await readJson(req);
  const name = (body.name || '').toString().slice(0, 120) || 'there';
  const title = (body.title || '').toString().slice(0, 160);
  const company = (body.company || '').toString().slice(0, 160) || 'their company';
  const channel = CHANNELS[body.channel] ? body.channel : 'li';
  const step = Math.min(5, Math.max(1, parseInt(body.step, 10) || 1));
  const steer = (body.steer || '').toString().slice(0, 240).trim();
  const angle = (body.angle || '').toString().slice(0, 400).trim();
  const priorRel = (body.priorRelationshipNotes != null ? body.priorRelationshipNotes : (body.priorRelationship || '')).toString().slice(0, 300).trim();

  // Resolve the sender identity: request → stored profile (user.sender) →
  // defaults (normalizeSender fills intro + asset; name may stay blank).
  const sender = normalizeSender({
    name: body.senderName != null ? body.senderName : (user.sender && user.sender.name),
    intro: body.senderIntro != null ? body.senderIntro : (user.sender && user.sender.intro),
    company: body.senderCompany != null ? body.senderCompany : (user.sender && user.sender.company),
    credibility: body.senderCredibility != null ? body.senderCredibility : (user.sender && user.sender.credibility),
    defaultAsset: body.defaultAsset != null ? body.defaultAsset : (user.sender && user.sender.defaultAsset),
  });
  const senderIntro = scrubHelp(sender.intro);
  const senderCred = scrubHelp(sender.credibility);
  // Dynamic sender line — never "I'm —": drop the name clause if there's no name.
  const senderLine = sender.name ? ('I’m ' + sender.name + ' — ' + senderIntro) : senderIntro;

  // Soft angle handling: MISSING (no signal) / THIN (weak, client-flagged) /
  // STRONG (default when a signal is provided). Missing/thin surface a warning.
  const angleStrength = !angle ? 'missing'
    : (String(body.angleStrength || '').toLowerCase() === 'thin' ? 'thin' : 'strong');
  const angleWarning =
    angleStrength === 'missing' ? 'No signal provided — opened on their role and company. Add a specific signal for a sharper first line.'
    : angleStrength === 'thin' ? 'Weak signal — the opener stays careful and hedged. A concrete detail will sharpen it.'
    : null;
  const SIGNAL_MODE = {
    strong: 'SIGNAL STRENGTH: STRONG. Open confidently and specifically on the signal/notes below.',
    thin:   'SIGNAL STRENGTH: THIN. The signal is weak or unverified — open with careful, hedged language ("looks like", "appears", "noticed"). State nothing as certain; do not overclaim.',
    missing:'SIGNAL STRENGTH: NONE. No specific signal is available — open from their role or company in general terms. Do NOT invent specifics, metrics, events, or quotes; draw curiosity from their likely priorities, not fabricated facts.',
  }[angleStrength];

  const prompt =
    CHANNELS[channel] + '\n\n' +
    'PROSPECT: ' + name + (title ? ', ' + title : '') + ' at ' + company + '.\n\n' +
    'SENDER — introduce them in the brief sender line; never invent a name, title, or backstory:\n' +
    (sender.name ? '  Name: ' + sender.name + '\n' : '  (No name provided — introduce without a name, using the sender line as-is.)\n') +
    '  Sender line to use (you may lightly rephrase ONLY to obey the banned-word rules): ' + senderLine + '\n' +
    (senderCred ? '  Credibility (supporting proof only — never the opener): ' + senderCred + '\n' : '') +
    '\n' +
    SIGNAL_MODE + '\n' +
    (angle ? 'SIGNAL / NOTES (user-provided, unverified — weave in naturally, do not quote): ' + angle + '\n' : '') +
    (priorRel ? 'PRIOR RELATIONSHIP (use as credibility AFTER the prospect-first opener — never lead with it): ' + priorRel + '\n' : '') +
    'PREFERRED ASSET for the CTA: ' + sender.defaultAsset + '. Build the final asset-based CTA around it (e.g. "I built a quick ' + sender.defaultAsset + ' around this — should I send it over?"). Never make the CTA a meeting or call request.\n' +
    (TOUCH[step] || '') + '\n' +
    (steer ? 'DIRECTION / TONE from the sender (follow it while keeping every rule above): ' + steer + '\n' : '') +
    '\nWrite the single message now, following the Engine 7 structure and the channel length limit exactly. Return only the message.';

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return send(res, 502, { error: 'AI service error (' + r.status + ').', detail: detail.slice(0, 300) });
    }

    const data = await r.json();
    const text = (data && Array.isArray(data.content) ? data.content : [])
      .filter(function (b) { return b && b.type === 'text'; })
      .map(function (b) { return b.text; })
      .join('')
      .trim();

    if (!text) return send(res, 502, { error: 'AI returned an empty draft. Try again.' });

    // Count this draft against the user's monthly quota.
    user.ai[mk] = used + 1;
    await kv.set(userKey(s.sub), user);

    const remaining = unlimited ? null : Math.max(0, FREE_AI_PER_MONTH - user.ai[mk]);
    return send(res, 200, { text: text, remaining: remaining, angleWarning: angleWarning });
  } catch (e) {
    return send(res, 500, { error: String((e && e.message) || e) });
  }
}
