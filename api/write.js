// Drafts a single outreach message with Claude (Haiku — cheapest model).
// Used by the "Write with AI" button in each queue card. Returns { text }.
import { kv, send, readJson, requireSession, userKey } from './_lib.js';

const FREE_AI_PER_MONTH = 25;
function monthKey() { return new Date().toISOString().slice(0, 7); } // 'YYYY-MM'

const CHANNELS = {
  li: 'a short LinkedIn message (2–4 sentences, no subject line, warm and human, not salesy — the goal is to start a conversation, not to pitch)',
  em: 'a short cold email — start with a "Subject: ..." line, then the body (3–5 short sentences), sign off as Marcos',
  call: 'brief call notes / a talk track (bullet points): an opener, one good question to ask, a reminder to listen more than pitch, and the goal of booking 15 minutes',
};

const STEP_CONTEXT = {
  1: 'This is the FIRST touch — they have never heard from Marcos. Keep it light and low-pressure.',
  2: 'This is a follow-up — a previous LinkedIn/email touch went unanswered. Reference that lightly without guilt-tripping.',
  3: 'Third touch. Still no reply. Stay friendly and brief; add a small new angle or piece of value.',
  4: 'Fourth touch. Persistent but respectful. Acknowledge you have reached out before.',
  5: 'Final touch (a call). This is the last planned attempt — make it count, keep it human, leave a short voicemail if no answer.',
};

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

  const system =
    'You write outreach messages for Marcos Cuellar, a recruiter at Spyglass Partners. ' +
    'Marcos helps mid-market brands add engineering and data talent — onshore and nearshore — without big-firm overhead. ' +
    'His voice is direct, warm, and human: no corporate filler, no hype, no fake urgency, no emoji. ' +
    'Never invent facts about the person or their company. Never make promises about specific candidates or results. ' +
    'Output ONLY the message itself — no preamble, no explanation, no quotation marks around it.';

  const prompt =
    'Write ' + CHANNELS[channel] + '.\n\n' +
    'Recipient: ' + name + (title ? ', ' + title : '') + ' at ' + company + '.\n' +
    (STEP_CONTEXT[step] || '') + '\n\n' +
    (steer ? 'Direction from Marcos (follow this while keeping his voice and the rules above): ' + steer + '\n\n' : '') +
    'Write it now.';

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 400,
        system: system,
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
