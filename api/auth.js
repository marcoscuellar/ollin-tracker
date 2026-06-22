// Passkey (WebAuthn) auth for a single-user app, via SimpleWebAuthn v13 + Vercel KV.
// One handler, switched on ?action=:
//   status | register-options | register-verify | login-options | login-verify | logout
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import crypto from 'node:crypto';
import {
  kv, KEYS, getRP, readJson, send,
  parseCookies, setCookie, clearCookie,
  SESSION_COOKIE, CHALLENGE_COOKIE,
  signSession, requireSession,
  bufToB64url, b64urlToBuf, sha256,
  genRecoveryCode, normalizeCode,
} from './_lib.js';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const CHALLENGE_TTL_S = 300;

export default async function handler(req, res) {
  const action = (req.query && req.query.action) || '';
  try {
    switch (action) {
      case 'status': return status(req, res);
      case 'register-options': return registerOptions(req, res);
      case 'register-verify': return registerVerify(req, res);
      case 'login-options': return loginOptions(req, res);
      case 'login-verify': return loginVerify(req, res);
      case 'logout': return logout(req, res);
      default: return send(res, 400, { error: 'unknown action' });
    }
  } catch (e) {
    return send(res, 500, { error: String((e && e.message) || e) });
  }
}

function readChallenge(req) {
  try { return JSON.parse(parseCookies(req)[CHALLENGE_COOKIE] || '{}'); } catch { return {}; }
}
function setSession(res) {
  setCookie(res, SESSION_COOKIE, signSession({ sub: 'owner', exp: Date.now() + SESSION_TTL_MS }), { maxAge: SESSION_TTL_MS / 1000 });
}

async function status(req, res) {
  const owner = await kv.get(KEYS.owner);
  return send(res, 200, { registered: !!owner, authenticated: !!requireSession(req) });
}

async function registerOptions(req, res) {
  const { rpID, rpName } = getRP(req);
  const owner = await kv.get(KEYS.owner);
  const creds = (await kv.get(KEYS.credentials)) || [];
  const userID = owner && owner.userID ? b64urlToBuf(owner.userID) : new Uint8Array(crypto.randomBytes(16));

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID,
    userName: (owner && owner.name) || 'ollin-owner',
    attestationType: 'none',
    excludeCredentials: creds.map((c) => ({ id: c.id, transports: c.transports })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });

  setCookie(res, CHALLENGE_COOKIE, JSON.stringify({ challenge: options.challenge, userID: bufToB64url(userID) }), { maxAge: CHALLENGE_TTL_S });
  return send(res, 200, options);
}

async function registerVerify(req, res) {
  const { rpID, origin } = getRP(req);
  const body = await readJson(req);
  const ch = readChallenge(req);
  if (!ch.challenge) return send(res, 400, { error: 'Challenge expired — try again.' });

  const owner = await kv.get(KEYS.owner);
  // Adding a device to an existing owner requires the recovery code.
  if (owner) {
    const stored = await kv.get(KEYS.recovery);
    if (!stored || sha256(normalizeCode(body.recoveryCode)) !== stored) {
      return send(res, 403, { error: 'A valid recovery code is required to add another device.' });
    }
  }

  const attResp = body.attResp || body.response || body;
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: attResp,
      expectedChallenge: ch.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch (e) {
    clearCookie(res, CHALLENGE_COOKIE);
    return send(res, 400, { error: String((e && e.message) || 'registration failed') });
  }

  if (!verification.verified || !verification.registrationInfo) {
    clearCookie(res, CHALLENGE_COOKIE);
    return send(res, 400, { error: 'Registration could not be verified.' });
  }

  const cred = verification.registrationInfo.credential; // v13: { id, publicKey, counter, transports }
  const creds = (await kv.get(KEYS.credentials)) || [];
  creds.push({
    id: cred.id,
    publicKey: bufToB64url(cred.publicKey),
    counter: cred.counter || 0,
    transports: cred.transports || (attResp.response && attResp.response.transports) || [],
  });
  await kv.set(KEYS.credentials, creds);

  let recoveryCode = null;
  if (!owner) {
    recoveryCode = genRecoveryCode();
    await kv.set(KEYS.recovery, sha256(normalizeCode(recoveryCode)));
    await kv.set(KEYS.owner, { userID: ch.userID, name: 'ollin-owner', createdAt: Date.now() });
  }

  clearCookie(res, CHALLENGE_COOKIE);
  setSession(res);
  return send(res, 200, { verified: true, recoveryCode });
}

async function loginOptions(req, res) {
  const { rpID } = getRP(req);
  const creds = (await kv.get(KEYS.credentials)) || [];
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: creds.map((c) => ({ id: c.id, transports: c.transports })),
    userVerification: 'preferred',
  });
  setCookie(res, CHALLENGE_COOKIE, JSON.stringify({ challenge: options.challenge }), { maxAge: CHALLENGE_TTL_S });
  return send(res, 200, options);
}

async function loginVerify(req, res) {
  const { rpID, origin } = getRP(req);
  const body = await readJson(req);
  const ch = readChallenge(req);
  if (!ch.challenge) return send(res, 400, { error: 'Challenge expired — try again.' });

  const resp = body.authResp || body.response || body;
  const creds = (await kv.get(KEYS.credentials)) || [];
  const dbCred = creds.find((c) => c.id === resp.id);
  if (!dbCred) return send(res, 400, { error: 'Unknown credential for this device.' });

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: resp,
      expectedChallenge: ch.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: dbCred.id,
        publicKey: b64urlToBuf(dbCred.publicKey),
        counter: dbCred.counter,
        transports: dbCred.transports,
      },
      requireUserVerification: false,
    });
  } catch (e) {
    clearCookie(res, CHALLENGE_COOKIE);
    return send(res, 400, { error: String((e && e.message) || 'login failed') });
  }

  if (!verification.verified) {
    clearCookie(res, CHALLENGE_COOKIE);
    return send(res, 400, { error: 'Login could not be verified.' });
  }

  dbCred.counter = verification.authenticationInfo.newCounter;
  await kv.set(KEYS.credentials, creds);
  clearCookie(res, CHALLENGE_COOKIE);
  setSession(res);
  return send(res, 200, { verified: true });
}

function logout(req, res) {
  clearCookie(res, SESSION_COOKIE);
  return send(res, 200, { ok: true });
}
