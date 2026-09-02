# Outbound copy standard

What the drafting AI is held to, and where each rule comes from.

Source: *The Science and Evolution of High-Converting B2B Outbound* (Master Report).
Encoded in `api/engine7.js`; enforced in `api/write.js`, which re-drafts once on any failure.

## The premise

The message is read on a phone, in about eleven seconds, between two meetings.
It is scanned, not read: sender and subject, first sentence, the shape of the
body, the last line. Every rule below follows from that.

## The numbers

| Rule | Standard | Where |
|---|---|---|
| Body length | 25–75 words; tighter per touch (t1 25–60, t5 25–45) | `WORD_BUDGET`, `TOUCH_WORDS` |
| Reading level | written for grade 3–5; gate fires at grade 10 | `fkGrade`, `FK_GATE` |
| Paragraphs | 1–2 sentences per block; gate fires at 4 | `denseBlocks` |
| Subject line | 1–3 lowercase words, internal style; gate at 5 | `auditDraft` |
| CTA | interest-based, asset-based, final line | `SYSTEM`, `MEETING_ASKS` |

Two numbers worth remembering: an interest-based ask ("open to reviewing it?")
converts near 37% against ~15% for a time-based one ("30 minutes Thursday?"),
and response rates fall off a cliff past 75 words.

## The structure

Every message: **1 observation + 3 proof angles + 1 low-friction asset ask.**

1. **Them first** — one dated, checkable observation.
2. **Brief sender line** — from the stored sender profile, never invented.
3. **Back to them** — the diagnostic insight, the curiosity.
4. **Asset CTA** — the final line, always. Never a meeting.

## Signal durability

- **Perishable** (< 6 months): role open 45+ days, new VP, funding, migration.
  This is news — it leads the message.
- **Durable** (12–18 months): stated philosophy, standing cost mandate.
  This is not news — it is a bridge used *after* the opener. Presenting a
  durable fact as fresh is the tell that nobody actually looked.

Set per draft via `signalDurability`; defaults to perishable.

## Proof discipline

The engine has no verified benchmark data, so it invents none. Peer metrics,
percentages, headcounts and case studies come from the request or the sender's
credibility line, or they are left out. A fabricated number is the one mistake
the prospect can check.

## Staffing rules

- **Stalled req (45+ days)** — anchor on lost delivery velocity and the scarce
  stack by name, never on recruiting as a service.
- **Candidate-led (MPC)** — never a full resume; three anonymised bullets
  (shipped / stack / availability), profile offered as the asset.
- **AVL / MSP / VMS** — never position against internal TA or the incumbent.
  Position as the specialist for what stayed unfilled past day 30–45.
- **Nearshore** — timezone, then cultural parity, then cost; acknowledge what
  they already run onshore first.

## The nine gates

Any NO is a rewrite, not a ship. Six are decided in code (`auditDraft`) rather
than asked of the model, because a model marking its own homework passes itself
on length and banned words more often than it should:

1. every claim traces to the request · 2. inside the word band ·
3. reading level · 4. no banned wording · 5. subject line shape ·
6. interest-based CTA, last line · 7. plain text, scannable blocks ·
8. opens about them, real sender identity · 9. nothing invented.
