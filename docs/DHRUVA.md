# Interview Operations Portal on Supabase

This is the Dhruva team portal moved off Google Apps Script and Google Sheets
onto a Node.js server and a Supabase (Postgres) database.

**Nothing in the UI or the business logic was rewritten.** The portal page
(`Working Portal.html`) and all six Apps Script projects in `portals/dhruva/` are
the original files, byte-for-byte. They run on a runtime that emulates the
Google services they use (SpreadsheetApp, PropertiesService, CacheService,
LockService, Utilities, MailApp, UrlFetchApp, ScriptApp, HtmlService…), with
Supabase as the storage instead of Google Sheets.

```
Browser ── same portal page ──► Node server ──► original Apps Script code (6 projects)
         google.script.run → /api/run      │       running in isolated V8 contexts
                                            └──► in-memory copy of every sheet ──► Supabase (write-through)
```

## Why it is built this way

The logic addresses data by spreadsheet, tab, row and column ("Source Row
13469", "Team Data Row 1642", date blocks in Raw Data / InterviewBot, getLastRow,
insertRowsAfter…). Re-modelling that into normalised tables would mean
rewriting ~180,000 lines of logic, which is exactly what you asked not to do.
So each Google tab is stored row-by-row in Postgres (`gs_rows`), and readable
column views are generated for every tab that has a header row.

## What is in the box

| Path | What it is |
|---|---|
| `portals/dhruva/` | The 6 original Apps Script projects, unchanged |
| `server/` | The runtime and HTTP server (no npm dependencies) |
| `server/gas-client.js` | `google.script.run` for the browser — same API as Apps Script |
| `public/sheets.html` | Sheet editor (replaces editing the Google Sheets directly) |
| `supabase/migrations/` | Database schema, save functions, RLS, 59 readable views |
| `tools/SupabaseExport.gs` | One-time exporter you run inside each Apps Script project |
| `config/projects.json` | Which project is bound to which spreadsheet |

### Projects and workbooks

| Project (`config/projects.json`) | Apps Script folder | Bound spreadsheet |
|---|---|---|
| `portal` | Interview Incentive Portal | Interview Portal Control |
| `pune-call-tracker` | call Tracker | Call Tracker |
| `pune-incentives` | Incentives | Incentive tracker (Raw Data / Team Data) |
| `pune-private-backend` | Incentive Backend - Private | Incentive Backend - Private |
| `hyd-call-tracker` | HYD Incentive Tracker | HYD Incentive Tracker |
| `hyd-private-backend` | HYD Incentive Backend - Private | HYD Incentive Backend - Private |

The spreadsheet IDs are kept as the primary keys, because the code refers to
them (`openById("1Q5p…")`).

## Setup

### 1. Create the database
Create a Supabase project, then run the three files in `supabase/migrations/`
in order (SQL editor, or `supabase db push`). Every table has RLS on with no
policies: only the server's service-role key can read or write.

### 2. Copy the data out of Google (one time)
In **each of the 6 Apps Script projects** (open the spreadsheet → Extensions →
Apps Script):

1. Add a file with the contents of `tools/SupabaseExport.gs`.
2. Set `URL`, `SERVICE_ROLE_KEY`, and `PROJECT` (the name from the table above).
3. Run `exportToSupabase`. If it stops near the 6-minute limit, run it again; it resumes.
4. Delete the file afterwards (it contains the service-role key).

The exporter copies every tab (values, number formats, display text, sizes,
frozen rows), **all Script Properties**, the installable triggers, and the
web-app URL. The Script Properties matter: they hold login sessions, bridge
secrets, team routing and the identity-workbook IDs the incentive engine uses
to canonicalise candidate names. Do not skip any project.

The bridge URLs in Script Properties keep pointing at `script.google.com/…/exec`;
the server recognises them (from the exported web-app URLs) and runs the
target project in-process instead.

### 3. Configure and run the server
```bash
cp .env.example .env     # fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PUBLIC_URL, mail settings
npm run check            # loads all 6 projects, checks Supabase + export status
npm start                # Node 20+
```
Open `PUBLIC_URL`. In the combined app, sign-in is Google (the Dhruva email-code screen is skipped).

**Email:** login codes are sent with `MailApp.sendEmail` in the original code.
Set `RESEND_API_KEY` + `MAIL_FROM` (or `MAIL_WEBHOOK_URL`). Without one, codes
are only printed in the server log.

**Hosting:** the combined app runs on Vercel; see "How Dhruva runs on Vercel"
in the main README. Any number of copies can run at once.

### 4. Cut over
1. Ask everyone to stop using the old portal and stop editing the sheets.
2. Run the exporter in all 6 projects again (fresh copy).
3. Start the server and share the new URL.

## Day-to-day differences

- **Editing sheet data:** where people used to type or paste into the Google
  Sheets (Raw Data, Team Data, InterviewBot, master lists…), they now use
  `/sheets` (button-free URL: `PUBLIC_URL/sheets`). It uses the portal login;
  by default only `SUPER_ADMIN` and `ADMIN` can edit (`SHEET_EDITOR_ROLES`).
  Editing a cell fires the same edit triggers as Google (e.g. marking Team Data
  status "Selected" stamps the selection date). The custom menus from the
  sheets (e.g. **Incentives → Run Incentive Scan**) appear at the top and run
  the same functions, including their confirmation prompts.
- **Long operations** (incentive scan, bulk approvals, applying recoveries,
  completing a team day) run on background worker threads, so the portal
  stays responsive while they run, as it did on Google.
- **Speed:** most calls take 10–300 ms (Google took seconds). The incentive
  scan still takes about 3 minutes because the matching engine itself is
  heavy; its logic was not changed.

## Things to know

- **Formulas are not recalculated.** Cell values are stored as they were at
  export time; formulas are kept for reference (`gs_rows.x`). The portal code
  writes values only, so it is unaffected. A tab that relies on live sheet
  formulas would show the exported values.
- **Cell colours, column widths, dropdown validation** are not stored. The
  code that sets them still runs (as no-ops).
- **External writers:** anything that wrote into these Google Sheets from
  outside (a bot, Zapier, a form, people pasting) must now write through
  `/sheets`. If a bot fills InterviewBot automatically, it needs to be pointed
  at the new system.
- **Editing Supabase directly** while the server runs is not picked up until
  restart (the server holds the working copy). Use `/sheets`, or restart after
  manual SQL changes.
- **Only the portal's own functions are callable from the browser** (the ones
  the page references). Apps Script allowed any public function; set
  `GAS_ALLOW_ALL_PUBLIC=1` to restore that.
- `UrlFetchApp` only reaches the six projects; other URLs, DriveApp and
  DocumentApp are not available (the code does not use them).

## Querying the data
Each header-based tab has a view named `<workbook>__<tab>`, e.g.
```sql
select * from pune_private_backend__incentive_tracker where handler = 'Naresh';
select * from hyd_private_backend__hyd_call_outcome_requests where request_status = 'Pending';
```
Block-layout tabs (Raw Data, InterviewBot, …) are in `gs_rows_view`
(`workbook`, `tab`, `row_num`, `cells[]`).
