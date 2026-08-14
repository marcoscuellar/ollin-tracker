# Ollin Auth + Storage Kit — reusable

**This is the canonical account + per-user storage layer for Ollin apps on Vercel.
Reuse it for anything that needs sign-in + a document saved per user — the ADHD
context app, future products, etc. DO NOT rebuild this from scratch.**

Source of truth: `ollin-tracker/api/` (runs in production on heyvamos.app).

---

## What it gives you

- **Accounts** — email + password, **scrypt-hashed with a per-user salt** (passwords
  are never stored in the clear).
- **Sessions** — a **signed session cookie** (`ollin_session`), verified server-side
  on every request. No third-party auth service.
- **Password reset** — request-reset + reset endpoints.
- **Per-user storage** — one JSON document per user in **Vercel KV**, keyed
  `entries:<userId>`. `GET` loads it on sign-in, `POST` saves the whole thing.
  Because it's server-side and keyed to the account, **it syncs across machines**
  automatically (sign in anywhere → your doc loads).

## The 3 files to copy

| File | What it is |
|---|---|
| `api/_lib.js` | The core: KV client, cookies, `signSession`/`verifySession`/`requireSession`, `hashPassword`/`verifyPassword` (scrypt), user-key helpers (`user:`, `useremail:`, `entries:`). |
| `api/auth.js` | The endpoints: register, login, logout, request-reset, reset. |
| `api/entries.js` | The per-user document: `GET` loads, `POST` validates + saves. |

> ⚠️ When reusing outside Vamos, delete the Vamos-only line in `_lib.js` that
> re-exports from `engine7.js` (`DEFAULT_SENDER_INTRO`, etc.) — that's tracker
> content, not part of the auth/storage core.

## Setup in a new project (e.g. the ADHD app)

1. `npm i @vercel/kv`
2. Create a **Vercel KV** (or Upstash Redis) store and add its env vars:
   - `KV_REST_API_URL` and `KV_REST_API_TOKEN`
     *(or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`)*
   - `AUTH_SECRET` — a long random string; it signs the session cookies.
   - `RESEND_API_KEY` — sends verification and password-reset mail.
   - `MAIL_FROM` — optional; defaults to `VAMOS <hello@send.anywayidid.com>`.
     **Must be on a domain verified in Resend**, which is not necessarily the
     domain the app is served from.
3. Copy the 3 files into the new project's `/api`.
4. **Rename the data endpoint for the new app**: in `entries.js`, change the key
   from `entries:<id>` to your app's namespace (e.g. `adhd:<id>`) and replace the
   `EMPTY` payload shape + the `POST` validation with your app's data shape.
5. Front end:
   - Auth: `POST /api/auth?action=login` (also `register`, `logout`,
     `request-reset`, `reset`).
   - Data: `GET /api/entries` to load the user's doc, `POST /api/entries` to save it.

## When signups go quiet — checking mail

Email verification gates real features (in Vamos, AI drafting returns 403 until
`user.verified`), so a silent mail failure looks like a broken product rather
than a broken config. Two things make it visible:

- Every `sendEmail` failure is `console.error`'d with the reason and the From
  address — check the Vercel function logs first.
- `GET /api/auth?action=mail-check`, signed in as the owner
  (`SIGNUP_ALERT_EMAIL`, falling back to `LEGACY_OWNER_EMAIL`), reports whether
  `RESEND_API_KEY` is set and then sends a real test message to the owner. It
  never returns the key. A set key that still fails almost always means the
  `MAIL_FROM` domain isn't verified in Resend.

That's the whole kit. Same accounts, same server-saved document, in any Ollin app —
built once, here.
