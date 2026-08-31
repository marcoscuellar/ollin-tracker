# Second product — working brief

**Status:** seed draft. Nothing here is decided. Written from what Marcos said on
2026-08-31 so the conversation has something to push against. Edit it directly —
strike lines out, write in the margins, argue with it.

---

## 1. What was said

Verbatim intent, cleaned up from voice-to-text:

- Build a **second product, standalone** — not a mode or a tab inside vamos.
- It is **ADHD-shaped**. That is the organising idea, not a feature.
- It gets its **own colour**. Not Signal Black + volt.
- There is a **paid tier around $40–50/month** where **Ollin does the research
  for you** — you ask, it goes and does it, you get the result back.
- There is something under that tier that is free or cheaper.
- A reference app was named in dictation and came out garbled. Marcos corrected:
  *"i don tmean toby boy"* — so **the reference is still unknown.** First thing
  to nail down; it probably answers half of section 4 on its own.

---

## 2. What "ADHD-shaped" has to mean to be real

This is the part that decides whether the product is a real thing or a
re-skinned tracker. A guess at what it means, to be confirmed or thrown out:

- **One thing on screen.** Not a list of twelve you have to triage. The app
  picks. vamos already does this with "Up next" and it is the piece Marcos
  protects hardest — *"it helps me focus"*. That instinct is the seed of the
  whole product.
- **No blank page.** Every screen opens with something already filled in.
  Starting is the expensive part, not finishing.
- **The cost of dropping it is zero.** Close the tab for nine days, come back,
  and it does not greet you with 40 overdue items and a broken streak. It
  re-picks and moves on. Guilt mechanics are the opposite of the product.
- **Finishing is loud.** The done state is the most designed thing in the app.
- **You never have to remember the shape of your own work.** The app holds the
  structure; you supply energy in the window you have it.

If the product ends up being "a to-do list with a calmer colour", it isn't it.

---

## 3. Where the $40–50 tier earns its money

The paid promise is **Ollin does the research**. That is the only line in the
dictation that is unambiguous, and it happens to be the strongest thing here:
it is the one feature a competitor cannot ship by adding a checkbox.

The shape it wants:

1. You describe a thing you need to know, in a sentence.
2. It goes away. You close the app.
3. It comes back with an answer you can act on, not a pile of links.

The ADHD framing and the research tier fit together better than they look:
**the tax is not doing the work, it is the ramp-up before the work.** Paying to
have the ramp removed is a coherent thing to sell.

Open: is the research generic (anything) or bounded to a domain? Bounded is
easier to make good and easier to price. Generic is easier to market and much
harder to keep from being disappointing.

---

## 4. Decisions that block everything else

Nothing should be built before these four have answers.

| # | Question | Why it blocks |
|---|---|---|
| 1 | **What was the reference app?** | Sets the whole interaction model. Everything below is cheaper to answer once this is named. |
| 2 | **Who is the buyer?** | An ADHD professional buying for themselves is a $10–20 impulse with a $40 upgrade when a specific job appears. A team lead buying for a team is a different product, different onboarding, different price ladder. These do not converge later. |
| 3 | **What does the free tier actually do?** | If free is a crippled trial, nobody stays long enough to hit the paid moment. If free is genuinely useful, it has to be useful without any Ollin research spend — which means the free product must stand on structure alone. **This is the question the product lives or dies on.** |
| 4 | **One codebase with a flag, or a separate build?** | See below. |

### On #4, a recommendation

**Separate build.** Reasons, in order of weight:

- vamos is one 5,900-line `index.html` in quirks mode with every style in one
  `<style>` and every behaviour in one IIFE. It works, but it has no seams to
  put a flag into. A product flag through that file makes both products harder
  to change, and vamos is the one currently earning attention.
- The two products disagree at the root. vamos is a **pipeline** — sequence,
  cadence, coverage, a queue that must drain. The new one is **anti-queue** by
  design: it should never show you a backlog. The same data model cannot serve
  both without one of them being a compromise.
- Different colour, different type, different voice. Sharing a stylesheet buys
  nothing when almost every token differs.

What *is* worth carrying over, as copied code, not shared code:

- The storage/auth kit (`docs/AUTH_STORAGE_KIT.md`) — solved, portable.
- The "Up next" single-focus pattern.
- The glass/white card doctrine, re-tokenised to the new colour.
- The Ollin request → result plumbing, once the vamos Ollin page exists.

---

## 5. Open questions, smaller

- Does it need an account on day one, or does it work locally and offer sync?
  (Local-first is a much lower barrier and fits "close the tab" behaviour.)
- Mobile-first or desktop-first? The ADHD framing points at the phone.
- Does the research tier meter (N requests/month) or run flat? Metering makes
  a small number feel small; flat risks a heavy user costing more than they pay.
- Name. Nothing has been proposed.
- Does it know about vamos at all — one account, two apps — or are they
  strangers that happen to share an author?

---

## 6. What happens next

This brief is the artefact to argue against. The recommended order:

1. Answer #1 (the reference app) — one sentence, unblocks the most.
2. Answer #2 and #3 together; they are really one question about the buyer.
3. Then, and only then, mockups. Same process as the vamos revamp: screens
   first, nothing built until the screens are agreed.
4. #4 gets settled by whatever #3 turns out to be, but the default is a
   separate build.

Meanwhile vamos has its own outstanding queue — the Ollin page, the save-flush
fix, the cadence dating fix, report import, Inter as the body font — and none
of it should stall behind this.
