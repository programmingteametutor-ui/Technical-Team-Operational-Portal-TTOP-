# TTOP Portal: Technical Team Operational Portal

An interview tracking hub for candidates, interviews, clients, closers and incentives. It's a single `index.html` page hosted on Vercel, with Supabase as the database and sign-in.

## Folders

| Path | What it is |
|---|---|
| `index.html` | The whole app (no build step) |
| `api/config.js` | Gives the page the public Supabase URL and anon key |
| `api/sync-doc.js` | Google Doc sync: reads the Sirian Interview Tracker at 6 AM and 6 PM IST |
| `api/interview-inbox/` | Interview Inbox: reads recruiter emails (MySQL, read only) every 4 hours |
| `api/push-alerts.js` | Phone alarms, every 5 minutes: 10 minutes before a technical call (to the Tool Drive and the candidate's Technical POC), a call within the hour with no Tool Drive (to the POC), and due reminders. They repeat up to 3 times until Got it; Got it / Snooze use a signed token. A signed-in user can send a test alert or alarm |
| `manifest.json`, `sw.js`, `icons/` | Install as a phone app (network first, so a deploy always shows) and show phone alerts |
| `api/_lib/` | Shared server code: Interview Inbox (`inbox.js`, `extract.js` reads the emails) and phone alerts (`push.js`) |
| `vercel.json` | Tells browsers to always check for a new `index.html`, so a deploy shows up without a hard refresh |
| `supabase/` | SQL to run in Supabase > SQL Editor (not deployed) |
| `docs/` | Setup guides: `DOC_SYNC_SETUP.md` and `INTERVIEW_INBOX_SETUP.md` |
| `test/` | Tests for the Interview Inbox, the Doc sync parser, the page's core helpers (`core.test.js`), phone alarms (`push-alerts`) and the team update (`team-update`): `npm install && npm test` |

## Vercel environment variables

| Name | Used by |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `SUPABASE_URL`, `SUPABASE_ANON_KEY`) | the page |
| `SUPABASE_SERVICE_ROLE_KEY` | Doc sync, Interview Inbox (server only) |
| `CRON_SECRET` | the scheduled Doc sync, Inbox fetch and phone alerts |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Interview Inbox: the recruiter email database (use a SELECT-only login) |
| `INTERVIEW_IMPORT_START_DATE` (e.g. `2026-10-27`), `INBOX_DB_TIMEZONE` (`UTC` or `+05:30`) | Interview Inbox |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:` + an admin email) | Phone alerts. Make the key pair once with `npx web-push generate-vapid-keys` |

## Database (`supabase/`)

There is one SQL file: `supabase/reset_and_setup_DELETES_ALL_DATA.sql`. It holds every rule the portal uses (tables, security rules, incentive rules, closers and placed status, duplicate protection, doc sync and inbox schedules, live updates, phone alerts, expected placements, reminders, and the admin Excel upload).

- **Full reset:** it deletes all portal data and rebuilds everything (Google logins are kept). First take a backup with Settings → **Download all data**, fill in `YOUR-APP` / `YOUR_CRON_SECRET` in the doc sync and inbox schedule parts, check the admin and team emails in PART 3, then uncomment the `set app.allow_reset` line and run it in Supabase → SQL Editor.
- **Live portal, one missing piece:** do not run the whole file. Copy only the `-- ---------- PART: ...` section you need and run that. The Excel upload part (`PART: EXCEL UPLOAD`) is written to be run on its own.
- **Restore data:** Settings → **Upload Excel to database** with a file from **Download all data**.

After a deploy, people with the portal open see a **"A new version of the portal is available · Reload"** bar; a normal reload is enough.
