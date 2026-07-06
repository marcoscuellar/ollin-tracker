// Email + password auth for a multi-user app, on Vercel KV.
// One handler, switched on ?action=:
//   signup | login | logout | status | verify | request-reset | reset | resend-verify
import {
  kv, KEYS, readJson, send, getRP,
  setCookie, clearCookie, SESSION_COOKIE,
  signSession, requireSession,
  normalizeEmail, userKey, emailKey, entriesKey,
  newUserId, makeSalt, hashPassword, verifyPassword,
  signToken, verifyToken, sendEmail, emailShell,
  MIGRATED_FLAG, LEGACY_OWNER_EMAIL,
} from './_lib.js';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const VERIFY_TTL_MS = 1000 * 60 * 60 * 24;        // 24h
const RESET_TTL_MS = 1000 * 60 * 60;              // 1h
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default async function handler(req, res) {
  const action = (req.query && req.query.action) || '';
  try {
    switch (action) {
      case 'signup': return signup(req, res);
      case 'login': return login(req, res);
      case 'logout': return logout(req, res);
      case 'status': return status(req, res);
      case 'verify': return verify(req, res);
      case 'request-reset': return requestReset(req, res);
      case 'reset': return reset(req, res);
      case 'resend-verify': return resendVerify(req, res);
      default: return send(res, 400, { error: 'unknown action' });
    }
  } catch (e) {
    return send(res, 500, { error: String((e && e.message) || e) });
  }
}

function setSession(res, userId) {
  setCookie(res, SESSION_COOKIE, signSession({ sub: userId, exp: Date.now() + SESSION_TTL_MS }), { maxAge: SESSION_TTL_MS / 1000 });
}

async function sendVerifyEmail(req, user) {
  const { origin } = getRP(req);
  const token = signToken({ typ: 'verify', sub: user.id }, VERIFY_TTL_MS);
  const url = `${origin}/api/auth?action=verify&token=${encodeURIComponent(token)}`;
  return sendEmail({
    to: user.email,
    subject: 'Welcome to ANYWAY — confirm your email',
    html: emailShell(
      'Welcome to ANYWAY.',
      "You're in. Confirm your email and your account is locked to you — then it's just you, your queue, and one honest touch at a time. You can start using ANYWAY right now; this just keeps it yours.",
      { text: 'Confirm your email', url }
    ),
  });
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

  // Best-effort: never fail signup if the email doesn't send.
  try { await sendVerifyEmail(req, user); } catch (e) { /* ignore */ }

  return send(res, 200, { ok: true, email, plan: 'free', verified: false, migrated });
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
  return send(res, 200, { ok: true, email, plan: user.plan || 'free', verified: !!user.verified });
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
  return send(res, 200, { authenticated: true, email: user.email, plan: user.plan || 'free', verified: !!user.verified });
}

// GET — clicked from the verification email. Marks verified, then redirects
// back into the app with a ?verified flag for a toast.
async function verify(req, res) {
  const { origin } = getRP(req);
  const token = (req.query && req.query.token) || '';
  const p = verifyToken(token, 'verify');
  let ok = false;
  if (p && p.sub) {
    const user = await kv.get(userKey(p.sub));
    if (user) {
      if (!user.verified) { user.verified = true; await kv.set(userKey(p.sub), user); }
      ok = true;
    }
  }
  res.statusCode = 302;
  res.setHeader('Location', `${origin}/?verified=${ok ? '1' : '0'}`);
  return res.end();
}

// POST { email } — always returns ok so we never reveal which emails exist.
async function requestReset(req, res) {
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  const id = await kv.get(emailKey(email));
  if (id) {
    const { origin } = getRP(req);
    const token = signToken({ typ: 'reset', sub: id }, RESET_TTL_MS);
    const url = `${origin}/?reset=${encodeURIComponent(token)}`;
    try {
      await sendEmail({
        to: email,
        subject: 'Reset your ANYWAY password',
        html: emailShell(
          'Reset your password',
          "Click below to set a new password. This link works for one hour. Didn't ask for this? Ignore it — your password stays exactly as it is.",
          { text: 'Set a new password', url }
        ),
      });
    } catch (e) { /* ignore */ }
  }
  return send(res, 200, { ok: true });
}

// POST { token, password } — sets a new password and logs the user in.
async function reset(req, res) {
  const body = await readJson(req);
  const password = String(body.password || '');
  if (password.length < 8) return send(res, 400, { error: 'Password must be at least 8 characters.' });
  const p = verifyToken(String(body.token || ''), 'reset');
  if (!p || !p.sub) return send(res, 400, { error: 'This reset link is invalid or has expired. Request a new one.' });
  const user = await kv.get(userKey(p.sub));
  if (!user) return send(res, 400, { error: 'Account not found.' });
  const salt = makeSalt();
  user.salt = salt;
  user.passwordHash = hashPassword(password, salt);
  await kv.set(userKey(p.sub), user);
  setSession(res, user.id);
  return send(res, 200, { ok: true, email: user.email, plan: user.plan || 'free', verified: !!user.verified });
}

// POST (session-gated) — resend the verification email.
async function resendVerify(req, res) {
  const s = requireSession(req);
  if (!s || !s.sub) return send(res, 401, { error: 'unauthorized' });
  const user = await kv.get(userKey(s.sub));
  if (!user) return send(res, 401, { error: 'unauthorized' });
  if (user.verified) return send(res, 200, { ok: true, already: true });
  const r = await sendVerifyEmail(req, user);
  return send(res, 200, { ok: !!r.ok });
}
