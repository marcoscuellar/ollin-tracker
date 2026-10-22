# Scheduled outreach

Approve an email touch and it leaves on its due morning without anyone coming
back to press send. Approval is still the only thing that sends: nothing is
queued until a person presses **Approve & queue** on a draft that passed the
audit, and **Cancel** pulls it back from Resend until the moment it goes.

## What a user sees

- On an email touch (touches 2 and 4 of the cadence), a second button under
  the draft: **Approve & queue · Thu, Oct 22 · from 07:30**. LinkedIn touches
  are unchanged; nothing can send those for you.
- Pressing it queues the email for its due day. The card turns into a
  *Queued* panel with the exact time it leaves and a Cancel button; the draft
  locks. The Up Next list shows **QUEUED · 7:34 AM** on that contact.
- When Resend sends it, the touch is logged as sent and the next touch is
  scheduled, exactly as if "Let's go" had been pressed. A bounce stops that
  contact's cadence and marks the address Do Not Use. A spam complaint also
  marks the contact as opted out.
- **Settings** (avatar → Account → Edit intro) has a *Sending* section:
  send-as address, where replies go, first send of the day, timezone, daily
  cap, how many days ahead a touch may be queued, and a pause switch.

## How the morning spreads out

The day's first queued touch leaves at the send hour (07:30 by default). Each
later approval sits three minutes further along plus a stable 0–4 minute
jitter of its own, so twenty-five approvals cover roughly the next two hours
rather than landing as one burst. A touch approved after its slot has passed
goes out a few minutes from now.

## Guardrails (enforced in `api/_send-lib.js`, tested in `test/send-lib.test.js`)

A touch is refused, with the reason shown, when:

- sending is paused, or no send-as address is set
- it is a LinkedIn touch
- the contact is a Blocker, opted out, or their address bounced before
- the contact has no usable email, or an email confidence below 70%
  (a contact with no confidence recorded, e.g. from a CSV, is allowed: the
  user supplied the address)
- the draft is empty or fails the Engine 8 audit
- the due day is further out than the horizon (7 days by default, max 14)
- the daily cap (25 by default, max 100) is already reached for that day
- the touch is already queued or already sent

Every queued email carries one opt-out line at the end.

## Setup (once per deployment)

1. **Verified sending domain.** Resend must have the send-as domain verified.
   `SEND_DOMAINS` lists what is allowed (comma-separated, default
   `ollinos.com`); the Settings card refuses anything else.
2. **Webhook.** Resend → Webhooks → Add endpoint:
   `https://go.ollinos.com/api/resend-webhook`, events `email.sent`,
   `email.delivered`, `email.delivery_delayed`, `email.bounced`,
   `email.complained`. Put the signing secret in Vercel as
   `RESEND_WEBHOOK_SECRET`. Without it the endpoint refuses every delivery
   and queued touches stay "queued" in the app after they have gone out.
3. `RESEND_API_KEY` is the same key the app already uses for mail.

## Where the state lives

The queue is server-owned: `queue:<userId>` in KV, written only by
`api/send.js` (queue, cancel) and `api/resend-webhook.js` (status). The page
reads it on load (`GET /api/send`) and never writes it, so a client save can't
overwrite what the webhook recorded. The page turns the queue into cadence
facts (done, next touch, closed contact) through its own existing functions.

## Endpoints

```
GET  /api/send                         → { queue }
POST /api/send { action: "queue", acctId, threadId, touchNo, subject, body, dueDate }
POST /api/send { action: "cancel", touchId }
POST /api/resend-webhook               (Resend only; Svix-signed)
POST /api/auth?action=save-send        { sendAs, replyTo, sendHour, tz, dailyCap, horizonDays, paused }
```

## Not yet

Replies are not read. Phase one: a reply lands in the reply-to inbox and the
person marks the contact replied in the app. Phase two reads the inbox.
