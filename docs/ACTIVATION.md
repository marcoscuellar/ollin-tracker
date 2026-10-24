# Activation: the cadence reacts to what the prospect does

A fixed cadence sends the same next touch on the same day whether the prospect
opened three times, clicked the asset, replied "try me in January", or never
opened anything. Activation changes that: every event on a contact changes
what the app **proposes** next, and says why. The person accepts with one
tap. Nothing moves or sends on an event alone.

## Where it shows

- **On the card**, above "Next touch point": the contact's state, the
  proposal with its reason, one Accept button, and two taps for what the
  system cannot see on its own: *They replied* and *LinkedIn accepted*.
- **In Up Next**: a state pill on the rail (WARM, REPLIED, PARKED), and the
  order changes so a reply always sits above a scheduled touch and a warm
  contact above a cold one.
- **In the draft**: the writer is told what has happened so far, so a nudge
  reads like a nudge and a reply reads like a reply.

## States

Cold → Touched → Warm (opened or clicked) → Replied, or Parked (they named a
date), Opted out (they said no, or bounced, or complained), Resting (the
sequence ran out and nothing came back).

## The rulebook (first matching row wins)

| What happened | Proposed next move |
|---|---|
| asked not to be contacted, complained, or bounced | stop |
| a new company signal lands on a resting or parked contact | start a fresh sequence from the signal |
| replied, negative | mark opted out and stop |
| replied, "later" with a date | park until that date, one touch on that day |
| replied, positive or neutral | stop the sequence; this card becomes the reply, drafted from what they wrote |
| out of office until a date past the next touch | move the next touch to when they are back |
| sequence complete, silent 14 days | resting |
| accepted or replied on LinkedIn since the last touch | pull the next touch forward to tomorrow |
| clicked within 7 days, no reply | pull forward to tomorrow, written around what they clicked |
| opened 3+ times, no click, no reply | make the next touch a two-line nudge |
| 2 emails, none opened, next touch is email | send the next touch on LinkedIn instead |
| 2 emails, none opened, next touch is LinkedIn | rest a week |
| otherwise | keep the schedule |

What accepting does, in the app's own terms: pull forward, push, park and
rest a week rewrite the touch's date exactly as the gap picker does; switch
channel flips the touch to LinkedIn; nudge and reply hand the writer a steer;
stop is "Not a fit"; restart clears the contact's touches and starts touch 1
today. None of them send.

## Where the events come from

| Event | Source |
|---|---|
| sent, delivered, bounced, complained | the Resend webhook, through the queue (built with scheduled outreach) |
| opened, clicked | the Resend webhook, `email.opened` / `email.clicked`. **Open tracking must be switched on for the sending domain in Resend** or these never arrive |
| sent (manual "Let's go") | the app, when the person logs a send |
| sent, before the event log existed | backfilled once from the logged send date |
| replied, with tone and optional date | the *They replied* tap, until the inbox is read (phase two) |
| LinkedIn accepted | the *LinkedIn accepted* tap |
| new company signal | an OLLIN report or company note (increment 3) |

Events live on the contact as `events: [{at, kind, touchNo, channel, detail}]`
inside the entries blob the app already saves. The rulebook is
`nextMoveFor(...)` inside `index.html` under `/* @export:activation */`, with
one test per row in `test/activation.test.js`.

## What is deliberately manual

- Accepting a proposal. The system never moves a date on its own.
- LinkedIn touches.
- Replies, until phase two reads the reply-to inbox and classifies them.

## Next

1. Phase two: read the reply-to inbox (Gmail, read-only), match senders to
   contacts, classify the reply, and cancel any queued touch the moment a
   reply lands.
2. Restart on new signals, fed by Engine 5 re-runs.
3. The Engine 7 gate in front of Approve & queue.
