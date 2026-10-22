// Resend → ŌLLIN GO. Resend calls this when a queued email is sent,
// delivered, bounces, or draws a complaint. Each event names the user and the
// touch through the tags the send carried, and the matching queue entry moves
// forward. The page reads the queue on load and turns "sent" into a logged
// touch and "bounced" into a stopped contact; the server only records truth.
//
// Set up once: Resend → Webhooks → Add endpoint
//   https://go.ollinos.com/api/resend-webhook
//   events: email.sent, email.delivered, email.delivery_delayed, email.bounced, email.complained
// then put the signing secret in Vercel as RESEND_WEBHOOK_SECRET.
import { kv, send } from './_lib.js';
import { verifySvix, statusForEvent, advanceStatus, untagValue } from './_send-lib.js';
import { queueKey } from './send.js';

// The signature is over the raw bytes, so helpers that pre-parse the body
// must not get in the way. Vercel honours this for the Node runtime.
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[webhook] RESEND_WEBHOOK_SECRET is not set — refusing every delivery');
    return send(res, 503, { error: 'webhook not configured' });
  }

  const raw = await readRaw(req);
  const h = (n) => String(req.headers[n] || '');
  const ok = verifySvix({ secret, id: h('svix-id'), timestamp: h('svix-timestamp'), signature: h('svix-signature'), body: raw });
  if (!ok) return send(res, 401, { error: 'bad signature' });

  let evt;
  try { evt = JSON.parse(raw); } catch { return send(res, 400, { error: 'bad json' }); }
  const status = statusForEvent(evt && evt.type);
  if (!status) return send(res, 200, { ok: true, ignored: evt && evt.type });

  const data = (evt && evt.data) || {};
  const tags = tagMap(data.tags);
  const userId = tags.user ? untagValue(tags.user) : '';
  const touchId = tags.touch ? untagValue(tags.touch) : '';
  if (!userId || !touchId) return send(res, 200, { ok: true, ignored: 'untagged' });

  const key = queueKey(userId);
  const q = (await kv.get(key)) || {};
  const entry = q[touchId];
  if (!entry) return send(res, 200, { ok: true, ignored: 'unknown touch' });
  if (entry.resendId && data.email_id && entry.resendId !== data.email_id) {
    return send(res, 200, { ok: true, ignored: 'id mismatch' });
  }

  const next = advanceStatus(entry.status, status);
  if (next !== entry.status) {
    entry.status = next;
    entry[next + 'At'] = evt.created_at || new Date().toISOString();
    if (status === 'bounced' && data.bounce) entry.bounce = String(data.bounce.message || data.bounce.type || '').slice(0, 300);
    await kv.set(key, q);
  }
  return send(res, 200, { ok: true, status: entry.status });
}

// Resend tags arrive as [{name,value}] or {name: value}; accept both.
function tagMap(tags) {
  const out = {};
  if (Array.isArray(tags)) for (const t of tags) if (t && t.name) out[t.name] = t.value;
  else if (tags && typeof tags === 'object') Object.assign(out, tags);
  return out;
}

// The raw body, whatever the runtime did to it: untouched stream when the
// parser is off, the original string when it kept one, and a re-serialised
// object as the last resort (Svix sends compact JSON, which stringify
// reproduces byte for byte).
function readRaw(req) {
  return new Promise((resolve) => {
    if (typeof req.body === 'string') return resolve(req.body);
    if (req.body && typeof req.body === 'object') return resolve(JSON.stringify(req.body));
    let data = '';
    req.setEncoding && req.setEncoding('utf8');
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(data));
  });
}
