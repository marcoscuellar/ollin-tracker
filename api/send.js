// Scheduled outreach. Approval queues an email touch with Resend for its due
// morning; the queue is server-owned state (queue:<userId>) that the page
// reads and never writes, so a client save can't clobber what the webhook
// recorded. Approval is not send: nothing is queued without a person pressing
// Approve on a draft that passed the audit, and Cancel pulls it back from
// Resend until the moment it leaves.
//
//   GET  /api/send                       → { queue }
//   POST /api/send { action: "queue", acctId, threadId, touchNo, subject, body, dueDate }
//   POST /api/send { action: "cancel", touchId }
//
// Env: RESEND_API_KEY (required), SEND_DOMAINS (default ollinos.com).
import { kv, readJson, send, requireSession, userKey, entriesKey } from './_lib.js';
import { auditDraft } from './engine7.js';
import {
  effectiveSettings, queueGuards, slotFor, bodiesFor, tagValue,
  countQueuedOnDay, localDateStr, daysBetweenStr,
} from './_send-lib.js';

export const queueKey = (id) => `queue:${id}`;

export default async function handler(req, res) {
  const s = requireSession(req);
  if (!s || !s.sub) return send(res, 401, { error: 'unauthorized' });
  const userId = s.sub;

  if (req.method === 'GET') {
    const queue = (await kv.get(queueKey(userId))) || {};
    return send(res, 200, { queue });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });

  const body = await readJson(req);
  const action = String(body.action || '');
  try {
    if (action === 'queue') return await queueTouch(res, userId, body);
    if (action === 'cancel') return await cancelTouch(res, userId, body);
    return send(res, 400, { error: 'unknown action' });
  } catch (e) {
    console.error('[send]', action, 'failed:', e && e.message);
    return send(res, 500, { error: 'Could not reach the mail service. Nothing was queued.' });
  }
}

async function queueTouch(res, userId, body) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return send(res, 500, { error: 'Sending is not configured on the server.' });

  const [user, entries, queue] = await Promise.all([
    kv.get(userKey(userId)), kv.get(entriesKey(userId)), kv.get(queueKey(userId)),
  ]);
  if (!user) return send(res, 401, { error: 'unauthorized' });
  const q = queue || {};
  const settings = effectiveSettings(user);

  const acctId = String(body.acctId || ''), threadId = String(body.threadId || '');
  const touchNo = Number(body.touchNo);
  if (!acctId || !threadId || !Number.isInteger(touchNo) || touchNo < 1) return send(res, 400, { error: 'Which touch?' });
  const touchId = `${acctId}|${threadId}|${touchNo - 1}`;

  const acct = ((entries && entries.accounts) || []).find((a) => a && a.id === acctId);
  const contact = acct && (acct.threads || []).find((t) => t && t.id === threadId);
  const touch = { id: touchId, ch: 'em', touchNo };

  const subject = String(body.subject || '').trim().slice(0, 200);
  const text = String(body.body || '').trim();
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dueDate || '')) ? String(body.dueDate) : localDateStr(new Date(), settings.tz);
  const draftForAudit = 'Subject: ' + subject + '\n' + text;
  const auditFailures = text ? auditDraft(draftForAudit, 'em') : [];

  const why = queueGuards({ contact, touch, settings, draft: text, auditFailures, queue: q, dueDate });
  if (!subject) why.unshift('The email needs a subject line.');
  if (why.length) return send(res, 422, { error: why[0], reasons: why });

  // slot: the day's first approval leaves at the send hour, later ones spread
  const today = localDateStr(new Date(), settings.tz);
  const day = daysBetweenStr(today, dueDate) > 0 ? dueDate : today;
  const indexInDay = countQueuedOnDay(q, day, settings.tz);
  const at = slotFor({ dueDate: day, settings, indexInDay, touchKey: touchId });

  const bodies = bodiesFor(text);
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: settings.sendAs,
      to: [contact.email],
      reply_to: settings.replyTo || undefined,
      subject,
      text: bodies.text,
      html: bodies.html,
      scheduled_at: at.toISOString(),
      tags: [
        { name: 'touch', value: tagValue(touchId) },
        { name: 'user', value: tagValue(userId) },
      ],
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    console.error(`[send] resend ${r.status} (from=${settings.sendAs}): ${t.slice(0, 300)}`);
    return send(res, 502, { error: r.status === 403 || r.status === 422 ? 'The mail service refused this send. Check the send-as domain in Settings.' : 'The mail service is unavailable. Try again in a minute.' });
  }
  const data = await r.json().catch(() => ({}));

  q[touchId] = {
    resendId: data.id || null,
    status: 'queued',
    sendAt: at.toISOString(),
    queuedAt: new Date().toISOString(),
    acctId, threadId, touchNo,
    to: contact.email, who: contact.name || '', company: acct.company || '',
    subject,
  };
  await kv.set(queueKey(userId), q);
  return send(res, 200, { ok: true, touchId, entry: q[touchId] });
}

async function cancelTouch(res, userId, body) {
  const key = process.env.RESEND_API_KEY;
  const touchId = String(body.touchId || '');
  const q = (await kv.get(queueKey(userId))) || {};
  const entry = q[touchId];
  if (!entry) return send(res, 404, { error: 'Nothing queued for that touch.' });
  if (entry.status !== 'queued' && entry.status !== 'delayed') {
    return send(res, 409, { error: `That touch is already ${entry.status}.`, entry });
  }
  if (entry.resendId && key) {
    const r = await fetch(`https://api.resend.com/emails/${encodeURIComponent(entry.resendId)}/cancel`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}` },
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error(`[send] cancel ${r.status}: ${t.slice(0, 300)}`);
      // Most likely it already left. Don't lie about it: leave the status
      // alone; the webhook will move it to sent.
      return send(res, 409, { error: 'Too late — that one has already gone out, or is going out now.', entry });
    }
  }
  entry.status = 'cancelled';
  entry.cancelledAt = new Date().toISOString();
  await kv.set(queueKey(userId), q);
  return send(res, 200, { ok: true, touchId, entry });
}
