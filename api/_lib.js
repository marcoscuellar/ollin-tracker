// Shared helpers for the OLLIN serverless API:
// KV client, cookie helpers, HMAC-signed sessions, base64url + sha256 helpers.
import { kv } from '@vercel/kv';
import crypto from 'node:crypto';

export { kv };

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
  return { rpID, origin, rpName: 'OLLIN Tracker' };
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
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Secure'];
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

// ---------- recovery code ----------
export function genRecoveryCode() {
  // 20 hex chars grouped XXXXX-XXXXX-XXXXX-XXXXX
  return crypto.randomBytes(10).toString('hex').toUpperCase().match(/.{1,5}/g).join('-');
}
export function normalizeCode(c) {
  return (c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
