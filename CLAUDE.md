# OLLIN Tracker — notes for Claude (READ THIS FIRST)

## What this is
A lead / outreach tracker. It is ONE file: `index.html`. No build, no framework.

## How the user works (IMPORTANT)
- The user is neurodivergent. Keep replies VERY SHORT. No long paragraphs.
- Do not dump options. Ask at most one short question, or just act.
- Do not re-explain things already done.

## Where the data lives
- Saved in the browser (localStorage / window.storage).
- All reads/writes go through one object: `ollinApi` in `index.html`.
  Methods: getAccounts/saveAccounts, getDone/saveDone, getNotes/saveNotes,
  getActive/setActive, getSeeded/setSeeded.
- To move data to a real backend later (Supabase, Google Sheet, REST), only
  change the bodies of `ollinApi` methods. Nothing else.

## Deploy
- Hosted on Vercel, project name: `spymarketintel`.
- Likely live at: https://spymarketintel.vercel.app

## History / status
- 2026-06-19: Refactored scattered storage calls into the `ollinApi` object.
  App behavior unchanged. Committed + pushed to branch
  `claude/quirky-rubin-v9de95`.
- A Vercel env var named `ollinApi` exists but is UNUSED. It can be deleted.
  (It was created by mistake from a naming mix-up — `ollinApi` is just a code
  object, not an env var.)

## If the user seems lost or frustrated
- Reassure: nothing is broken, work is saved.
- Keep it short. Do not ask them to comprehend a lot.
