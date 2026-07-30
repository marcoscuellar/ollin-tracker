# docs

## `OLLIN_SYSTEMS_v0.7.0.txt`

The complete ŌLLIN Systems reference — the five call-outs (`/signal`, `/intel`,
`/full-pathway`, `/email-copy`, `/ely`), the global operating rules, and every
engine spec. Verbatim and unedited.

It is here because the app's message writer sits downstream of it. Two rules in
particular are now enforced in code rather than only written down:

**Engine 8 § 6 — "any NO is a rewrite, not a ship."** `auditDraft()` in
`api/engine7.js` checks the half of the quality check that needs no judgement:
channel length, banned wording, the "help" family, meeting asks, em dashes, and
the email subject line. `api/write.js` feeds any failure back to the model
verbatim for exactly one rewrite. The other half — does it sound said rather
than written, would a VP read past line one — stays in the `SYSTEM` prompt,
because those are judgements and code cannot make them.

Once, not twice: past one rewrite the inputs are the problem rather than the
wording, and a second round spends the sender's quota to say so.

**Global rule 11 — the Client Communication Doctrine.** Lead with them, lead
with curiosity, humanize it, lead with facts. The `SYSTEM` prompt's four-part
structure already implements the first three; the fourth is why the signal
strength modes exist (`STRONG` / `THIN` / `NONE`), so a thin signal produces
hedged language instead of an invented specific.

### Note on Engine 7 vs Engine 8

The systems doc parks Engines 7A/7B/7C and makes Engine 8 the law for outreach.
This app runs **Engine 7 Lite**, which is not the same thing as those parked
engines — it is a product-shaped writer with the sender block, the asset-based
CTA, per-channel limits and the five-touch sequence, none of which Engine 8
describes. So Engine 8 was not dropped on top of it. What was taken from Engine
8 is its banned-string list and its enforced self-audit, which is the part
Engine 7 Lite was missing.
