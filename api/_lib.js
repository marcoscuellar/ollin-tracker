// Shared helpers for the OLLIN serverless API:
// KV client, cookie helpers, HMAC-signed sessions, base64url + sha256 helpers.
import { createClient } from '@vercel/kv';
import crypto from 'node:crypto';

// Build the KV client explicitly so it works whether the Upstash/Vercel
// integration provides KV_REST_API_* or UPSTASH_REDIS_REST_* env vars.
export const kv = createClient({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

// KV keys (single-user app).
export const KEYS = {
  owner: 'ollin:owner',             // { userID(base64url), name, createdAt }
  credentials: 'ollin:credentials', // [{ id, publicKey(base64url), counter, transports }]
  recovery: 'ollin:recovery',       // sha256 hex of the normalized recovery code
  entries: 'ollin:entries',         // { accounts, done, notes, active, seeded }
};

const SESSION_COOKIE = 'ollin_session';
const CHALLENGE_COOKIE = 'ollin_challenge';
export { SESSION_COOKIE, CHALLENGE_COOKIE };

// ---------- base64url (for storing passkey public keys / user ids) ----------
export function bufToB64url(buf) {
  return Buffer.from(buf).toString('base64url');
}
export function b64urlToBuf(str) {
  return new Uint8Array(Buffer.from(str, 'base64url'));
}

export function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

// ---------- relying party (derived from the request host) ----------
export function getRP(req) {
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString();
  const proto = (req.headers['x-forwarded-proto'] || 'https').toString().split(',')[0];
  const rpID = host.split(':')[0];
  const origin = `${proto}://${host}`;
  return { rpID, origin, rpName: 'CONT.' };
}

// ---------- request body ----------
export function readJson(req) {
  return new Promise((resolve) => {
    if (req.body != null) {
      if (typeof req.body === 'string') {
        try { return resolve(JSON.parse(req.body || '{}')); } catch { return resolve({}); }
      }
      return resolve(req.body);
    }
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// ---------- JSON response (runtime-agnostic) ----------
export function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

// ---------- cookies ----------
export function parseCookies(req) {
  const h = req.headers.cookie || '';
  const out = {};
  h.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
export function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Secure'];
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  let prev = res.getHeader('Set-Cookie') || [];
  if (!Array.isArray(prev)) prev = [prev];
  prev.push(parts.join('; '));
  res.setHeader('Set-Cookie', prev);
}
export function clearCookie(res, name) {
  setCookie(res, name, '', { maxAge: 0 });
}

// ---------- HMAC-signed session token ----------
function secret() {
  return process.env.AUTH_SECRET || '';
}
export function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function verifySession(token) {
  if (!token || !secret()) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac('sha256', secret()).update(parts[0]).digest('base64url');
  if (expected.length !== parts[1].length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[1]))) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); } catch { return null; }
  if (payload.exp && Date.now() > payload.exp) return null;
  return payload;
}
export function requireSession(req) {
  return verifySession(parseCookies(req)[SESSION_COOKIE]);
}

// ---------- multi-user accounts (email + password, scrypt) ----------
// Keys: user:<id> -> account record, useremail:<email> -> id, entries:<id> -> tracker blob.
export function normalizeEmail(e) { return (e || '').trim().toLowerCase(); }
export const userKey = (id) => `user:${id}`;
export const emailKey = (email) => `useremail:${normalizeEmail(email)}`;
export const entriesKey = (id) => `entries:${id}`;

// One-time migration of the legacy single-user blob (ollin:entries) to the
// first owner account that signs up with this email.
export const MIGRATED_FLAG = 'ollin:migrated';
export const LEGACY_OWNER_EMAIL = 'marcoscuellar99@icloud.com';

// Founding-member interest list: [{ email, at }] — people who raised their
// hand for unlimited (Pro) access during the early launch.
export const FOUNDING_LIST_KEY = 'founding:list';

// ---------- sender identity (outreach profile, set at onboarding) ----------
// Stored on the user record as user.sender. Used by api/write.js to introduce
// the rep after the prospect-first opener, instead of hardcoding a name.
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

export function newUserId() { return crypto.randomBytes(12).toString('hex'); }
export function makeSalt() { return crypto.randomBytes(16).toString('hex'); }
export function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}
export function verifyPassword(password, salt, expectedHex) {
  const got = Buffer.from(hashPassword(password, salt), 'hex');
  const exp = Buffer.from(String(expectedHex || ''), 'hex');
  return got.length === exp.length && crypto.timingSafeEqual(got, exp);
}
// Current session's user id (or null). requireSession is defined above.
export function sessionUserId(req) {
  const s = requireSession(req);
  return s && s.sub ? s.sub : null;
}

// ---------- purpose-scoped signed tokens (verify email, reset password) ----------
// Reuse the HMAC session signer; carry a `typ` so a token minted for one
// purpose can't be replayed for another.
export function signToken(payload, ttlMs) {
  return signSession({ ...payload, exp: Date.now() + ttlMs });
}
export function verifyToken(token, typ) {
  const p = verifySession(token);
  if (!p || p.typ !== typ) return null;
  return p;
}

// ---------- transactional email (Resend) ----------
export const MAIL_FROM = 'VAMOS <hello@send.anywayidid.com>';
export async function sendEmail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY not set' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: MAIL_FROM, to: Array.isArray(to) ? to : [to], subject, html }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return { ok: false, error: `resend ${r.status}: ${t.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// Branded HTML shell for VAMOS emails.
export function emailShell(headline, bodyHtml, cta) {
  const btn = cta
    ? `<tr><td style="padding:2px 32px 28px"><a href="${cta.url}" style="display:inline-block;background:#2D2D2D;color:#FCFBF9;text-decoration:none;font-weight:600;font-size:15px;padding:14px 26px;letter-spacing:.02em">${cta.text}</a></td></tr>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#F8F7F4;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#2D2D2D">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="460" cellpadding="0" cellspacing="0" style="max-width:460px;width:100%;background:#FCFBF9;border:1px solid #E7E3DC">
      <tr><td style="padding:28px 32px 0"><div style="font-family:'Arial Black',Arial,sans-serif;font-weight:900;font-size:22px;letter-spacing:-.02em;color:#111110">VAMOS</div></td></tr>
      <tr><td style="padding:22px 32px 6px"><h1 style="margin:0;font-size:21px;font-weight:800;letter-spacing:-.01em">${headline}</h1></td></tr>
      <tr><td style="padding:4px 32px 22px;font-size:15px;line-height:1.6;color:#4a4a4a">${bodyHtml}</td></tr>
      ${btn}
      <tr><td style="padding:18px 32px 26px;border-top:1px solid #E7E3DC;font-size:12px;line-height:1.5;color:#9A9A9A">You're receiving this because this email was used to sign up for VAMOS. If that wasn't you, you can ignore this message.</td></tr>
    </table>
    <div style="font-family:monospace;font-size:10px;letter-spacing:.16em;color:#9A9A9A;margin-top:16px">HEYVAMOS.APP</div>
  </td></tr></table></body></html>`;
}

// ---------- recovery code ----------
export function genRecoveryCode() {
  // 20 hex chars grouped XXXXX-XXXXX-XXXXX-XXXXX
  return crypto.randomBytes(10).toString('hex').toUpperCase().match(/.{1,5}/g).join('-');
}
export function normalizeCode(c) {
  return (c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
