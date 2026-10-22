// Scheduled outreach, the I/O-free half. Everything here is a pure function
// over plain data so it can be unit-tested without KV, Resend, or a clock:
// the sender settings and their validation, the morning send window and how
// touches are spread across it, the guardrails that decide whether a touch
// may be queued at all, the plain-text → HTML body, and the webhook signature
// check. api/send.js and api/resend-webhook.js do the I/O around these.
import crypto from 'node:crypto';

// ---------- settings ----------
// Per-user sending settings, stored on the user record as `send`. Every field
// has a default so a user who never opens Settings still gets sane behaviour.
export const SEND_DEFAULTS = Object.freeze({
  sendAs: '',            // "Marcos Cuellar <marcos@ollinos.com>" — must be on an allowed domain
  replyTo: '',           // where replies land; defaults to the login email
  sendHour: '07:30',     // local time the day's first queued touch goes out
  tz: 'America/New_York',
  dailyCap: 25,          // queued sends per day, hard ceiling 100
  horizonDays: 7,        // never queue further out than this
  paused: false,         // hold every queued touch without cancelling it
});

export const SPREAD_MIN_MINUTES = 3;   // gap between consecutive touches in a day
export const SPREAD_JITTER_MINUTES = 4; // extra, deterministic per touch, so nothing lands on a round minute
export const MAX_DAILY_CAP = 100;
export const MAX_HORIZON_DAYS = 14;    // Resend holds a scheduled email for 30; stale intel is the real limit

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;
const HOUR_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

// Domains the From address may use. Resend only sends from domains verified on
// the account, so this list is the deploy-time statement of what is verified.
export function allowedSendDomains(env = process.env) {
  return String(env.SEND_DOMAINS || 'ollinos.com')
    .split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
}

// "Name <addr>" or bare "addr" → { name, address } or null.
export function parseAddress(s) {
  const str = String(s || '').trim();
  if (!str) return null;
  const m = str.match(/^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/);
  const address = (m ? m[2] : str).trim().toLowerCase();
  const name = (m ? m[1] : '').trim();
  if (!EMAIL_RE.test(address)) return null;
  return { name, address };
}

export function formatAddress(name, address) {
  const n = String(name || '').replace(/[<>"]/g, '').trim();
  return n ? `${n} <${address}>` : address;
}

export function isValidTimeZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

// Validate and normalise a settings payload against the user. Returns
// { ok: true, send } or { ok: false, error } with a sentence a person can act on.
export function normalizeSendSettings(input, user, env = process.env) {
  const body = input && typeof input === 'object' ? input : {};
  const out = { ...SEND_DEFAULTS };
  const domains = allowedSendDomains(env);

  const sendAs = parseAddress(body.sendAs);
  if (body.sendAs && !sendAs) return { ok: false, error: 'The send-as address is not a valid email.' };
  if (sendAs) {
    const dom = sendAs.address.split('@')[1];
    if (!domains.includes(dom)) {
      return { ok: false, error: `Outreach can only be sent from ${domains.join(' or ')} — that domain is verified for sending. ${dom} is not.` };
    }
    out.sendAs = formatAddress(sendAs.name || (user && user.sender && user.sender.name) || '', sendAs.address);
  }

  if (body.replyTo) {
    const rt = parseAddress(body.replyTo);
    if (!rt) return { ok: false, error: 'The reply-to address is not a valid email.' };
    out.replyTo = rt.address;
  } else {
    out.replyTo = user && user.email ? String(user.email).toLowerCase() : '';
  }

  if (body.sendHour != null && body.sendHour !== '') {
    if (!HOUR_RE.test(String(body.sendHour))) return { ok: false, error: 'Send hour must look like 07:30.' };
    out.sendHour = String(body.sendHour);
  }

  if (body.tz) {
    if (!isValidTimeZone(String(body.tz))) return { ok: false, error: 'That timezone is not recognised.' };
    out.tz = String(body.tz);
  }

  if (body.dailyCap != null && body.dailyCap !== '') {
    const n = Math.floor(Number(body.dailyCap));
    if (!Number.isFinite(n) || n < 1 || n > MAX_DAILY_CAP) return { ok: false, error: `Daily cap must be between 1 and ${MAX_DAILY_CAP}.` };
    out.dailyCap = n;
  }

  if (body.horizonDays != null && body.horizonDays !== '') {
    const n = Math.floor(Number(body.horizonDays));
    if (!Number.isFinite(n) || n < 1 || n > MAX_HORIZON_DAYS) return { ok: false, error: `Queue horizon must be between 1 and ${MAX_HORIZON_DAYS} days.` };
    out.horizonDays = n;
  }

  out.paused = !!body.paused;
  return { ok: true, send: out };
}

// The settings a request should run with: stored values over defaults, with
// reply-to falling back to the login email.
export function effectiveSettings(user) {
  const s = { ...SEND_DEFAULTS, ...((user && user.send) || {}) };
  if (!s.replyTo && user && user.email) s.replyTo = String(user.email).toLowerCase();
  return s;
}

// ---------- time ----------
// Local wall-clock → UTC instant, for an IANA zone, without a tz library.
// Works by asking Intl what the zone's offset is at the candidate instant and
// correcting once (enough for any zone; DST transitions at the exact minute
// are the only case it can be off by an hour, and no one sends at 2am).
export function zonedTimeToUtc(dateStr, hhmm, tz) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  const offset = tzOffsetMinutes(new Date(guess), tz);
  const first = guess - offset * 60000;
  const offset2 = tzOffsetMinutes(new Date(first), tz);
  return new Date(offset2 === offset ? first : guess - offset2 * 60000);
}

// Minutes east of UTC for `tz` at instant `date`.
export function tzOffsetMinutes(date, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

// YYYY-MM-DD of an instant in a zone.
export function localDateStr(date, tz) {
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return dtf.format(date); // en-CA gives ISO order
}

// Deterministic 0..1 from a string, so a touch's jitter is stable across retries.
export function hash01(s) {
  const h = crypto.createHash('sha256').update(String(s)).digest();
  return h.readUInt32BE(0) / 0x100000000;
}

// When a touch goes out. The day's first queued touch leaves at sendHour;
// each later one sits SPREAD_MIN_MINUTES further along plus its own jitter, so
// a morning of 25 approvals spreads over roughly the next two hours instead of
// landing as one burst. A touch whose slot is already in the past (approved at
// 10am for today) goes in a few minutes from now, still jittered.
export function slotFor({ dueDate, settings, indexInDay, touchKey, now = new Date() }) {
  const jitter = Math.floor(hash01(touchKey) * (SPREAD_JITTER_MINUTES + 1)); // 0..4
  const minutes = indexInDay * SPREAD_MIN_MINUTES + jitter;
  const base = zonedTimeToUtc(dueDate, settings.sendHour, settings.tz);
  let at = new Date(base.getTime() + minutes * 60000);
  const soonest = new Date(now.getTime() + (2 + jitter) * 60000);
  if (at < soonest) at = soonest;
  return at;
}

// ---------- guardrails ----------
// Why a touch may not be queued, as sentences for the person; [] means go.
// `contact` is the tracker's thread record, `touch` the composite touch,
// `queue` the user's queue map, `now` the current instant.
export function queueGuards({ contact, touch, settings, draft, auditFailures = [], queue = {}, dueDate, now = new Date() }) {
  const why = [];
  if (!contact) return ['That contact is no longer on the account.'];
  if (settings.paused) why.push('Sending is paused in Settings.');
  if (!settings.sendAs) why.push('Set a send-as address in Settings first.');
  if (touch.ch !== 'em') why.push('Only email touches can be queued; LinkedIn is yours to send.');
  if (contact.persona === 'Blocker') why.push('Blockers are never sequenced.');
  if (contact.suppressed || contact.optOut) why.push('This contact asked not to be contacted.');
  if (contact.emailStatus === 'bounce') why.push('This address bounced; it is marked Do Not Use.');
  if (!contact.email || !EMAIL_RE.test(String(contact.email))) why.push('No usable email on this contact.');
  const conf = emailConfidencePct(contact.emailConf);
  if (conf != null && conf < 70) why.push(`Email confidence is ${conf}% — below the bar for automatic sending. Send this one yourself.`);
  if (!String(draft || '').trim()) why.push('Nothing to send: the draft is empty.');
  if (auditFailures.length) why.push('The draft has not passed the audit: ' + auditFailures.join(' '));

  const existing = queue[touch.id];
  if (existing && existing.status === 'queued') why.push('This touch is already queued.');
  if (existing && existing.status === 'sent') why.push('This touch was already sent.');

  // horizon, in the user's local calendar
  const today = localDateStr(now, settings.tz);
  if (dueDate && daysBetweenStr(today, dueDate) > settings.horizonDays) {
    why.push(`That is more than ${settings.horizonDays} days out. Approve it closer to the day so nothing goes out on stale intel.`);
  }

  // daily cap, counted on the local send day
  const day = dueDate && daysBetweenStr(today, dueDate) > 0 ? dueDate : today;
  const n = countQueuedOnDay(queue, day, settings.tz);
  if (n >= settings.dailyCap) why.push(`The daily cap of ${settings.dailyCap} is already reached for ${day}.`);

  return why;
}

export function emailConfidencePct(v) {
  if (v == null || v === '') return null;
  const m = String(v).match(/(\d{1,3})/);
  if (!m) return null;
  return Math.min(100, Number(m[1]));
}

export function daysBetweenStr(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export function countQueuedOnDay(queue, dayStr, tz) {
  let n = 0;
  for (const k of Object.keys(queue || {})) {
    const q = queue[k];
    if (!q || q.status !== 'queued' || !q.sendAt) continue;
    if (localDateStr(new Date(q.sendAt), tz) === dayStr) n++;
  }
  return n;
}

// ---------- body ----------
// One plain-text draft → the two bodies Resend gets. The HTML is the text with
// paragraphs, nothing else: outreach that looks like a person wrote it in
// their mail client, because that is what it is. The opt-out line is appended
// to both so every queued email carries a way out.
export const OPT_OUT_LINE = 'If this is not relevant, reply "no" and I will not write again.';

export function bodiesFor(text) {
  const t = String(text || '').trim();
  const plain = t + '\n\n' + OPT_OUT_LINE;
  const paras = plain.split(/\n{2,}/).map((p) => '<p>' + escapeHtml(p).replace(/\n/g, '<br>') + '</p>');
  const html = '<div style="font:15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a">' + paras.join('') + '</div>';
  return { text: plain, html };
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Resend tag values allow letters, numbers, underscores and dashes only. The
// touch id is "acct|thread|i"; keep it reversible by replacing the bars.
export function tagValue(s) {
  return String(s).replace(/\|/g, '__').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 256);
}
export function untagValue(s) {
  return String(s).replace(/__/g, '|');
}

// ---------- webhook signature (Svix, which Resend uses) ----------
// secret: "whsec_<base64>". Signed content: "<svix-id>.<svix-timestamp>.<raw body>".
// Header svix-signature: space-separated "v1,<base64 hmac-sha256>" entries.
export function verifySvix({ secret, id, timestamp, signature, body, now = Date.now(), toleranceSec = 300 }) {
  if (!secret || !id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > toleranceSec) return false;
  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();
  return String(signature).split(' ').some((part) => {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) return false;
    const got = Buffer.from(sig, 'base64');
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}

// Map a Resend event type to the queue status it implies; null = ignore.
export function statusForEvent(type) {
  switch (type) {
    case 'email.sent': return 'sent';
    case 'email.delivered': return 'delivered';
    case 'email.bounced': return 'bounced';
    case 'email.complained': return 'complained';
    case 'email.delivery_delayed': return 'delayed';
    default: return null;
  }
}

// Statuses only move forward; a late "sent" must not undo "delivered".
const RANK = { queued: 0, delayed: 1, sent: 2, delivered: 3, bounced: 3, complained: 4, cancelled: 9 };
export function advanceStatus(current, next) {
  if (!next) return current;
  if (current === 'cancelled') return current;
  return (RANK[next] ?? -1) >= (RANK[current] ?? -1) ? next : current;
}
