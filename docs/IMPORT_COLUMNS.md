# What to put in the CSV

Header row required. Column order does not matter. Matching is
case-insensitive. Anything not listed here is ignored, so extra columns are
harmless — send the export as it comes.

`IMPORT_TEMPLATE.csv` in this folder is a filled-in example.

## Required

| Column | Also accepted | Notes |
|---|---|---|
| **Name** | `Full Name`, `Contact`, or `First Name` + `Last Name` | Rows without a name are skipped. |
| **Company** | `Company Name`, `Account`, `Account Name`, `Organization`, `Employer`, `Current Company`, or any header containing "company" / "organization" / "employer" | Missing means everyone lands under "Imported account" — and the AI writes that phrase into the draft. The import now says so when it happens. `Account Owner` and `Account ID` deliberately do **not** count. |

## Worth having

| Column | Also accepted | Notes |
|---|---|---|
| Title | `Job Title` | |
| Email | `Email Address` | Needed to send email touches. |
| LinkedIn URL | `LinkedIn`, `LinkedIn Profile` | Makes the LinkedIn link on the card real. |
| Persona | `Outreach Thread`, `Thread` | Economic Buyer · Champion · Technical Evaluator · Gatekeeper · Blocker. Blocker is held out of cadence. |
| Outreach Angle | `Angle`, `Why This Person` | One line on why them. The AI leans on this. |
| Channel | `First Touch Channel`, `First Channel` | `em`, `li`, or `call`. |
| Sequence Day | `Entry Day`, `Day` | Which day of the cadence they start on. |
| Contractor | `Is Contractor` | `Yes` / `No`. |

## The intel panel

These fill "What Ōllin knows" on the opened card. Leave them out and that
panel reads NOT TRACKED — which is the honest answer, not a bug.

| Column | Needs a source column? |
|---|---|
| Signal | **Yes** — `Signal Source` |
| Hiring | **Yes** — `Hiring Source` |
| Building | **Yes** — `Building Source` |
| Stack | **Yes** — `Stack Source` |
| Money (or `Funding`) | **Yes** — `Money Source` |
| Sector (or `Industry`) | No |
| Location (or `Place`, `HQ`) | No |
| Company Size (or `Employee Count`) | No |
| Revenue | No |

**A claim without a source is dropped, not shown.** Valid sources are
`LinkedIn`, `Press`, `Job Board`, `Earnings`, `CRM`, `Product Data` — and for
Signal also `Email`, `Call Notes`, `Ōllin`. Anything else is treated as no
source at all. This is deliberate: the AI writes specifics into first-touch
copy, and an unsourced specific is how you end up telling a VP something
untrue about their own company.

## Touch copy

`Touch 1` … `Touch 5` (also `Touch 1 Copy`, `Touch 1 Message`, `Outreach 1`)
carry pre-written messages. Leave them empty and the AI drafts each one.

## Formats

CSV, `.xlsx`, `.xls`, or a Google Sheet link (share as "anyone with the link").
