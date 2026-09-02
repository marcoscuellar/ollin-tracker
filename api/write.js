// Drafts a single outbound message with Claude, server-side, using the
// ENGINE 7 LITE methodology. The prompt/methodology is never exposed to the
// client — users only ever receive the finished message text. Returns { text }.
// The pure prompt/sender/angle logic lives in ./engine7.js (I/O-free, tested);
// this file only wires it to auth, the monthly quota, and the Anthropic call.
import { kv, send, readJson, requireSession, userKey } from './_lib.js';
import { FREE_AI_PER_MONTH, quotaExceededMessage, buildDraftPrompt, auditDraft, rewritePrompt } from './engine7.js';

const MODEL = 'claude-sonnet-5';
function monthKey() { return new Date().toISOString().slice(0, 7); } // 'YYYY-MM'

/*
  What the sender is told when the call to the model fails. "AI service error
  (401)" was the same sentence for every failure, which made the two cases that
  matter indistinguishable: a 401 is a key the operator has to fix and no amount
  of retrying will help, while a 429 or a 529 is worth trying again in a minute.

  401/403 from api.anthropic.com means the key was rejected, not missing — a
  missing key is already caught above. Rejected means revoked or rotated, or a
  stray newline or quote around the value in the deploy environment, or a
  credential of the wrong kind (an OAuth token or an admin key sent as
  x-api-key, which this endpoint does not use).
*/
function upstreamMessage(status) {
  if (status === 401 || status === 403) {
    return 'AI drafting is misconfigured — the API key was rejected. Nothing you can do from here; the ANTHROPIC_API_KEY needs re-setting.';
  }
  if (status === 429) return 'Too many drafts at once — give it a minute and try again.';
  if (status === 529 || status >= 500) return 'The AI service is busy right now — try again in a minute.';
  return 'AI service error (' + status + ').';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });

  const s = requireSession(req);
  if (!s || !s.sub) return send(res, 401, { error: 'unauthorized' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return send(res, 500, { error: 'AI drafting is not configured (missing ANTHROPIC_API_KEY).' });

  // Enforce the free monthly AI quota (Pro and founding members are unlimited).
  const user = await kv.get(userKey(s.sub));
  if (!user) return send(res, 401, { error: 'unauthorized' });

  // Drafting spends the operator's API budget, so it is the one thing an
  // unconfirmed address cannot reach. The demo (?demo=1) never calls this —
  // it runs on seeded sample data with no account at all, which is how someone
  // sees the product before handing over an email.
  if (!user.verified) {
    return send(res, 403, { error: 'Confirm your email before drafting — check your inbox, or resend it from the banner up top.' });
  }

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
  const { system, prompt, angleWarning, channel, step, band } = buildDraftPrompt(user, body);

  // One turn of the conversation. Returns the draft text, or throws the
  // upstream failure for the caller to translate.
  async function ask(messages) {
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
        messages: messages,
      }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      const err = new Error(upstreamMessage(r.status));
      err.upstream = { status: r.status, detail: detail.slice(0, 300) };
      throw err;
    }

    const data = await r.json();
    return (data && Array.isArray(data.content) ? data.content : [])
      .filter(function (b) { return b && b.type === 'text'; })
      .map(function (b) { return b.text; })
      .join('')
      .trim();
  }

  try {
    const messages = [{ role: 'user', content: prompt }];
    let text = await ask(messages);

    /*
      Any NO is a rewrite, not a ship — ŌLLIN Systems, Engine 8 § 6.

      The quality check in SYSTEM is an instruction; auditDraft is the half of
      it that can be decided without judgement, so a length or banned-word miss
      is caught here rather than reaching the sender. The failures go back
      verbatim, which is a far better instruction than "try again".

      Once. Past that the inputs are the problem, not the wording, and a second
      round burns the sender's quota to say so.
    */
    const failures = auditDraft(text, channel, step);
    if (text && failures.length) {
      messages.push({ role: 'assistant', content: text });
      messages.push({ role: 'user', content: rewritePrompt(failures) });
      const second = await ask(messages);
      if (second) text = second;
    }

    if (!text) return send(res, 502, { error: 'AI returned an empty draft. Try again.' });

    // Count this draft against the user's monthly quota.
    user.ai[mk] = used + 1;
    await kv.set(userKey(s.sub), user);

    const remaining = unlimited ? null : Math.max(0, FREE_AI_PER_MONTH - user.ai[mk]);
    return send(res, 200, { text: text, remaining: remaining, angleWarning: angleWarning, band: band });
  } catch (e) {
    if (e && e.upstream) {
      return send(res, 502, { error: e.message, detail: e.upstream.detail });
    }
    return send(res, 500, { error: String((e && e.message) || e) });
  }
}
