// Drafts a single outbound message with Claude, server-side, using the
// ENGINE 7 LITE methodology. The prompt/methodology is never exposed to the
// client — users only ever receive the finished message text. Returns { text }.
import { kv, send, readJson, requireSession, userKey } from './_lib.js';

const MODEL = 'claude-sonnet-5';
const FREE_AI_PER_MONTH = 25;
function monthKey() { return new Date().toISOString().slice(0, 7); } // 'YYYY-MM'

// Channel spec + hard length limits (Engine 7 Lite LENGTH RULES).
const CHANNELS = {
  li:   'CHANNEL = LinkedIn. HARD LIMIT: 300 characters total. No subject line.',
  em:   'CHANNEL = Email. Start with one short "Subject:" line — specific and pattern-interrupt, no hype, lowercase-leaning. Then the body. HARD LIMIT: body ≤ 120 words. Sign off as Marcos.',
  call: 'CHANNEL = a spoken call opener + a short voicemail (≤ ~30 seconds each). Same 4-part structure, written the way Marcos would actually say it out loud, each ending on the asset-based CTA.',
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
  'You are ENGINE 7 LITE — the outbound message writer for Marcos Cuellar (Vamos / Ollin). You write a single high-conversion message using the Engine 7 methodology even when full account/contact research is unavailable. You never write generic outreach — you enforce the structure below.',
  '',
  'WHO MARCOS IS: a recruiter who helps mid-market brands add senior engineering and data talent — onshore and nearshore — without big-firm overhead or markup.',
  '',
  'CORE STRUCTURE — NON-NEGOTIABLE. Every message follows this exact order:',
  '1. THEM FIRST — open with a specific observation about the prospect, their company, team, role, or a provided signal. Never open with "I wanted to reach out," with Marcos\'s title, or with a pitch.',
  '2. BRIEF MARCOS LINE — one short bridge line on who Marcos is / what he runs. Brief. Not a pitch.',
  '3. BACK TO THEM, WITH CURIOSITY — a genuine question or curious observation tied to their likely priority, pressure, or signal. Curiosity is the close, not a pitch.',
  '4. ASSET-BASED CTA — end with ONE clear yes/no ask tied to a useful asset. This is always the final line.',
  '',
  'THE 1+3 (infer silently — never expose the analysis): THE 1 = one specific observation about them. THE 3 = a business/pain angle, a credibility angle, and a signal/urgency angle. Use them to shape the message; never print them.',
  '',
  'ASSET-BASED CTA — every message offers a useful artifact before asking for any time. Assets: Talent Map, Blueprint, Cost Analysis, Capacity Map, Hiring Signal Map, Role Gap Analysis. Approved CTA phrasings: "Want me to send it over?", "Should I send it over?", "Worth sending your way?", "Want the quick version?", "Should I send the map?", "Want me to share the Blueprint?". The primary CTA is NEVER a meeting or call request.',
  '',
  'BANNED WORDS — never use: Hope, Help, Check-in, Synergy, Thought, Connect. BANNED PHRASES — never use: "just reaching out", "might be worth", "no pressure", "wanted to reach out", "pick your brain", "circle back", "let me know", "thoughts?", "would love to connect", "are you open to a call", "can we meet", "I hope this finds you well". No emoji, no exclamation-mark hype.',
  '',
  'STYLE: minimalist, editorial, high-authority, human, confident, specific. No fluff, no generic openers.',
  '',
  'INTEL RULE: use whatever is provided (name, company, title, signal, prior relationship, warm path, notes). Treat provided intel as user-provided / unverified — use it carefully, never overclaim, never fabricate. If you lack a real signal, open from their role or company generally rather than inventing specifics.',
  '',
  'PRIOR RELATIONSHIP: if the notes indicate a prior relationship with the account, do NOT lead with it. Lead with the prospect/company signal first, then use the prior relationship as credibility after the opening observation.',
  '',
  'OUTPUT: return ONLY the finished message — no analysis, no scoring, no alternate versions, no quotation marks around it, no preamble.',
  '',
  'QUALITY CHECK before returning: opens about them · Marcos line is brief · curiosity present · CTA is asset-based · CTA is the final line · no banned words or phrases · channel length respected · no meeting ask.',
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
    return send(res, 402, { error: 'You’ve used your ' + FREE_AI_PER_MONTH + ' free AI drafts this month. Become a founding member for unlimited.' });
  }

  const body = await readJson(req);
  const name = (body.name || '').toString().slice(0, 120) || 'there';
  const title = (body.title || '').toString().slice(0, 160);
  const company = (body.company || '').toString().slice(0, 160) || 'their company';
  const channel = CHANNELS[body.channel] ? body.channel : 'li';
  const step = Math.min(5, Math.max(1, parseInt(body.step, 10) || 1));
  const steer = (body.steer || '').toString().slice(0, 240).trim();
  const angle = (body.angle || '').toString().slice(0, 400).trim();

  const prompt =
    CHANNELS[channel] + '\n\n' +
    'PROSPECT: ' + name + (title ? ', ' + title : '') + ' at ' + company + '.\n' +
    (angle ? 'KNOWN SIGNAL / NOTES (user-provided, unverified — weave in naturally, do not quote; if it names a prior relationship, apply the prior-relationship rule): ' + angle + '\n' : '') +
    (TOUCH[step] || '') + '\n' +
    (steer ? 'DIRECTION / TONE from Marcos (follow it while keeping every rule above): ' + steer + '\n' : '') +
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
    return send(res, 200, { text: text, remaining: remaining });
  } catch (e) {
    return send(res, 500, { error: String((e && e.message) || e) });
  }
}
