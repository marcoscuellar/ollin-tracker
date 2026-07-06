// Email + password auth for a multi-user app, on Vercel KV.
// One handler, switched on ?action=:  signup | login | logout | status
import {
  kv, KEYS, readJson, send,
  setCookie, clearCookie, SESSION_COOKIE,
  signSession, requireSession,
  normalizeEmail, userKey, emailKey, entriesKey,
  newUserId, makeSalt, hashPassword, verifyPassword,
  MIGRATED_FLAG, LEGACY_OWNER_EMAIL,
} from './_lib.js';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default async function handler(req, res) {
  const action = (req.query && req.query.action) || '';
  try {
    switch (action) {
      case 'signup': return signup(req, res);
      case 'login': return login(req, res);
      case 'logout': return logout(req, res);
      case 'status': return status(req, res);
      default: return send(res, 400, { error: 'unknown action' });
    }
  } catch (e) {
    return send(res, 500, { error: String((e && e.message) || e) });
  }
}

function setSession(res, userId) {
  setCookie(res, SESSION_COOKIE, signSession({ sub: userId, exp: Date.now() + SESSION_TTL_MS }), { maxAge: SESSION_TTL_MS / 1000 });
}

async function signup(req, res) {
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  if (!EMAIL_RE.test(email)) return send(res, 400, { error: 'Enter a valid email address.' });
  if (password.length < 8) return send(res, 400, { error: 'Password must be at least 8 characters.' });

  const existing = await kv.get(emailKey(email));
  if (existing) return send(res, 409, { error: 'An account with that email already exists — try logging in.' });

  const id = newUserId();
  const salt = makeSalt();
  const user = {
    id, email, salt,
    passwordHash: hashPassword(password, salt),
    createdAt: Date.now(),
    verified: false,
    plan: 'free',
    ai: {}, // { 'YYYY-MM': count } — AI draft usage per month
  };

  // First owner signup inherits the legacy single-user pipeline.
  let migrated = false;
  if (email === normalizeEmail(LEGACY_OWNER_EMAIL) && !(await kv.get(MIGRATED_FLAG))) {
    const legacy = await kv.get(KEYS.entries);
    if (legacy) {
      await kv.set(entriesKey(id), legacy);
      await kv.set(MIGRATED_FLAG, true);
      migrated = true;
    }
  }

  await kv.set(userKey(id), user);
  await kv.set(emailKey(email), id);
  setSession(res, id);
  return send(res, 200, { ok: true, email, migrated });
}

async function login(req, res) {
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  // Single generic error so we never reveal which emails have accounts.
  const fail = () => send(res, 401, { error: 'Wrong email or password.' });

  const id = await kv.get(emailKey(email));
  if (!id) return fail();
  const user = await kv.get(userKey(id));
  if (!user || !verifyPassword(password, user.salt, user.passwordHash)) return fail();

  setSession(res, id);
  return send(res, 200, { ok: true, email });
}

function logout(req, res) {
  clearCookie(res, SESSION_COOKIE);
  return send(res, 200, { ok: true });
}

async function status(req, res) {
  const s = requireSession(req);
  if (!s || !s.sub) return send(res, 200, { authenticated: false });
  const user = await kv.get(userKey(s.sub));
  if (!user) return send(res, 200, { authenticated: false });
  return send(res, 200, { authenticated: true, email: user.email, plan: user.plan || 'free' });
}
