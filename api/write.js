// Drafts a single outreach message with Claude. Used by the "Write with AI"
// button in each queue card. Returns { text }. Model: Sonnet — the prompt +
// this tier are what keep the drafts human and specific, not templated.
import { kv, send, readJson, requireSession, userKey } from './_lib.js';

const MODEL = 'claude-sonnet-5';
const FREE_AI_PER_MONTH = 25;
function monthKey() { return new Date().toISOString().slice(0, 7); } // 'YYYY-MM'

const CHANNELS = {
  li: 'a LinkedIn message: 2–4 short sentences, no subject line. It should read like a note one human types to another — a specific opener about THEM, one honest reason you\'re writing, and one low-friction ask (a question, or "worth a quick chat?"). Never a pitch.',
  em: 'a cold email. First line is "Subject: ..." — make the subject lowercase, specific, and un-salesy (e.g. "quick one on your eng roadmap", never "Transform Your Hiring!"). Then 3–5 short sentences, plain and direct, signed off as "Marcos". No greeting fluff.',
  call: 'a short call talk-track as 4–5 tight bullet points: a natural opener, ONE sharp question worth answering, a reminder to listen more than pitch, and the goal — book 15 minutes. Keep it to what Marcos would actually say out loud.',
};

const STEP_CONTEXT = {
  1: 'FIRST touch — they have never heard from Marcos. Earn the reply: lead with something specific to their role or company, keep it light, make the ask tiny.',
  2: 'Second touch — a first message went unanswered. Reference it in one breath without guilt ("figured this might have slipped by"), then add a fresh angle. Do not repeat the first message.',
  3: 'Third touch — still no reply. Shorter than before. Lead with one new, useful thought or observation, not "just following up."',
  4: 'Fourth touch — persistent but respectful. Acknowledge you\'ve reached out a couple times, keep it warm, give an easy out.',
  5: 'Final touch (a call / voicemail). Last planned attempt. Human and brief; if it\'s a voicemail, one clear reason to call back. No pressure, no guilt.',
};

const SYSTEM = [
  'You write outreach for Marcos Cuellar, a recruiter at Spyglass Partners.',
  'What Marcos does: he helps mid-market brands add senior engineering and data talent — onshore and nearshore — without big-firm overhead or markup.',
  '',
  'YOUR JOB: write outreach a sharp operator would actually be glad to receive. It must read like Marcos typed it himself in 30 seconds — human, specific, and easy to reply to.',
  '',
  'WHAT MAKES IT GOOD:',
  '- Open with THEM, not Marcos. Reference their role, company, or likely situation — something that shows you\'re writing to a person, not a list.',
  '- One honest reason for the message. One low-friction ask (a real question, or "worth a chat?"). Never a hard pitch, never multiple asks.',
  '- Short. Every sentence earns its place. Cut throat-clearing and set-up. Contractions. Plain words.',
  '- Confident and warm, never eager or salesy. Give an easy out. Sound like a peer, not a vendor.',
  '',
  'NEVER USE (these are what make outreach read as spam):',
  '"I hope this email finds you well", "I hope you\'re doing well", "I wanted to reach out", "I came across your profile", "just circling back", "just following up", "touch base", "hop on a quick call", "pick your brain", "at your earliest convenience", "please don\'t hesitate", "synergy", "leverage", "game-changer", "revolutionize", "in today\'s fast-paced world", "cutting-edge", "world-class", any exclamation-mark hype, and any emoji.',
  '',
  'HARD RULES:',
  '- Never invent facts about the person or their company. Personalize only from the name, title, and company you\'re given — if you don\'t know a detail, speak to their role or situation generally rather than making something up.',
  '- Never promise specific candidates, timelines, or results.',
  '- Output ONLY the message itself — no preamble, no notes, no quotation marks around it, no "Here\'s a draft".',
  '',
  'Example of the bar (LinkedIn, first touch):',
  'Hi Dana — saw your team\'s been scaling DTC engineering at Skechers. I help brands your size add senior/nearshore engineers without the agency markup, so I keep an eye on teams that are growing. If hiring\'s on your plate this quarter, happy to share what\'s working — otherwise no worries at all.',
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
    'Write ' + CHANNELS[channel] + '\n\n' +
    'Recipient: ' + name + (title ? ', ' + title : '') + ' at ' + company + '.\n' +
    (angle ? 'Angle / why this contact matters (Marcos\'s own note — weave it in naturally, don\'t quote it): ' + angle + '\n' : '') +
    (STEP_CONTEXT[step] || '') + '\n\n' +
    (steer ? 'Direction from Marcos (follow it while keeping his voice and every rule above): ' + steer + '\n\n' : '') +
    'Write the message now. Make it specific enough that it could only have been sent to this person.';

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
