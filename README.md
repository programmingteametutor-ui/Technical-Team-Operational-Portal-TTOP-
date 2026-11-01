# TTOP Portal: Technical Team Operational Portal

An interview tracking hub for candidates, interviews, clients, closers and incentives. It's a single `index.html` page hosted on Vercel, with Supabase as the database and sign-in.

## Folders

| Path | What it is |
|---|---|
| `index.html` | The whole app (no build step) |
| `api/config.js` | Gives the page the public Supabase URL and anon key |
| `api/sync-doc.js` | Google Doc sync: reads the Sirian Interview Tracker at 6 AM and 6 PM IST |
| `api/interview-inbox/` | Interview Inbox: reads recruiter emails (MySQL, read only) every 4 hours |
| `api/_lib/` | Shared server code for the Interview Inbox (`extract.js` reads the emails) |
| `vercel.json` | Tells browsers to always check for a new `index.html`, so a deploy shows up without a hard refresh |
| `supabase/` | SQL to run in Supabase > SQL Editor (not deployed) |
| `docs/` | Setup guides: `DOC_SYNC_SETUP.md` and `INTERVIEW_INBOX_SETUP.md` |
| `test/` | Tests for the Interview Inbox: `npm install && npm test` |

## Vercel environment variables

| Name | Used by |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `SUPABASE_URL`, `SUPABASE_ANON_KEY`) | the page |
| `SUPABASE_SERVICE_ROLE_KEY` | Doc sync, Interview Inbox (server only) |
| `CRON_SECRET` | the scheduled Doc sync and Inbox fetch |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Interview Inbox: the recruiter email database (use a SELECT-only login) |
| `INTERVIEW_IMPORT_START_DATE` (e.g. `2026-10-27`), `INBOX_DB_TIMEZONE` (`UTC` or `+05:30`) | Interview Inbox |

## SQL files (`supabase/`)

All of these are safe on the live database and can be run again, **except** `reset_and_setup_DELETES_ALL_DATA.sql`.

| File | When |
|---|---|
| `reset_and_setup_DELETES_ALL_DATA.sql` | **Only for a brand-new, empty project.** It wipes every table. Never run it on the live portal. |
| `doc_sync_setup.sql`, `doc_sync_page.sql` | Doc sync tables and the Auto Sync page (already run if the Auto Sync page works) |
| `turn_on_auto_sync.sql` | Schedules the Doc sync at 6 AM and 6 PM IST (fill in the portal address and `CRON_SECRET`) |
| `user_access.sql` | Approve / Remove users |
| `unassigned_include_inactive.sql` | The Unassigned filter also shows inactive candidates |
| `incentive_repeat_placement.sql` | Rule: repeat placements pay no Candidate POC share |
| `placement_tool_drive_fix.sql` | Placement incentives take the Tool Drive from the interview |
| `incentive_recipient_fix.sql` | Round incentives follow the Tool Drive; adds "Unassigned" |
| `interview_inbox.sql` | Interview Inbox tables and source columns |
| `interview_inbox_schedule.sql` | Inbox fetch every 4 hours (copies the address and secret from the Doc sync schedule) |
| `live_updates.sql` | Live updates: changes made by others appear without reloading |
| `round1_claim.sql` | "Add to my list" on 1st-round cards (you become the Tool Drive) |

Order for anything not run yet: run the files in the order of this table, after the reset file, which you skip on live. After a deploy, people with the portal open see a **"A new version of the portal is available · Reload"** bar; a normal reload is enough.
