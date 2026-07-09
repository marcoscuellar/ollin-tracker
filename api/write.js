// Drafts a single outbound message with Claude, server-side, using the
// ENGINE 7 LITE methodology. The prompt/methodology is never exposed to the
// client — users only ever receive the finished message text. Returns { text }.
// The pure prompt/sender/angle logic lives in ./engine7.js (I/O-free, tested);
// this file only wires it to auth, the monthly quota, and the Anthropic call.
import { kv, send, readJson, requireSession, userKey } from './_lib.js';
import { FREE_AI_PER_MONTH, quotaExceededMessage, buildDraftPrompt } from './engine7.js';

const MODEL = 'claude-sonnet-5';
function monthKey() { return new Date().toISOString().slice(0, 7); } // 'YYYY-MM'

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
    return send(res, 402, { error: quotaExceededMessage() });
  }

  const body = await readJson(req);
  // All Engine 7 Lite logic — sender resolution, soft angle handling, prompt
  // assembly — is pure and lives in engine7.js.
  const { system, prompt, angleWarning } = buildDraftPrompt(user, body);

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
    return send(res, 200, { text: text, remaining: remaining, angleWarning: angleWarning });
  } catch (e) {
    return send(res, 500, { error: String((e && e.message) || e) });
  }
}
