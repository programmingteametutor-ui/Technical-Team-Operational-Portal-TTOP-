# Interview Operations Portal (TTOP + Dhruva)

One app that hosts both portals, with one Google sign-in, one Supabase
database and one set of roles.

- **TTOP Portal** (`portals/ttop/`) and **Dhruva Portal** (`portals/dhruva/`)
  are the original code, unchanged. TTOP's page is served byte-for-byte; its
  API functions run as they did on Vercel. Dhruva's Apps Script logic runs on
  the Supabase runtime built earlier.
- **Shared data:** candidates and clients. A candidate or client added or
  renamed in either portal appears in the other. Interviews and incentives
  stay with each portal (each keeps its own incentive rules, so nothing is
  paid twice).

```
 /            home: Google sign-in, portal tiles, Access, Shared candidates & clients
 /ttop/       TTOP Portal              (+ /api/config, /api/sync-doc, /api/interview-inbox…, /api/push-alerts, /sw.js, /manifest.json, /icons/…)
 /dhruva/     Dhruva Portal            (+ /api/run, /sheets, /exec/<project>)
```

## Roles

| Role | Portals | Inside the portal |
|---|---|---|
| **Super admin** | Both | TTOP admin; any Dhruva role. Manages everyone on the Access page and the shared-data sync. |
| **Admin** | The portal(s) ticked for them | TTOP admin, or Dhruva up to ADMIN. Can add and edit **users** of their own portal. |
| **User** | The portal(s) ticked for them | TTOP user (sees their own candidates), or Dhruva up to HANDLER-level roles. |

How it is enforced:
- **Entry:** the server checks the role before serving `/ttop/` or `/dhruva/`
  and on every Dhruva call. Someone without access is sent back to the home page.
- **TTOP:** the Access list writes TTOP's own approval/admin flags
  (`profiles.approved / role / removed`, `admin_emails`) through database
  triggers, so TTOP's row-level security enforces it even for direct Supabase
  calls. Approvals a TTOP admin makes on TTOP's own Team page are mirrored back
  into the Access list.
- **Dhruva:** Dhruva's detailed roles (HANDLER, SETUP_SUPPORT, team scopes…)
  are still set in Dhruva Administration. The app role is a ceiling: a *user*
  whose Dhruva account has ADMIN, or an *admin* with SUPER_ADMIN, is refused
  with a clear message, and the Access page flags the mismatch.

Signing in once (Google) opens both portals. Dhruva's email-code screen is
skipped: the app creates the Dhruva session with Dhruva's own session code.
Signing out of Dhruva signs out of the app.

## Setup on Vercel

Use **TTOP's existing Supabase project** (it already holds TTOP's data and
Google logins). Do **not** run TTOP's `reset_and_setup_DELETES_ALL_DATA.sql`
on it: that file wipes the database.

The simplest route is to deploy this folder **to TTOP's existing Vercel
project** (replace the repository contents). Its address, environment
variables and TTOP's Supabase schedules then stay as they are.

1. **Database:** Supabase → SQL Editor, run the five files in
   `supabase/migrations/` in order. They only add tables (`gs_*` for Dhruva,
   `app_*` for the combined app), functions and triggers; no TTOP table or
   function is changed. File 4 copies TTOP's current users into the Access list.
2. **Dhruva data:** copy it from Google Sheets with `tools/SupabaseExport.gs`
   (paste it into each of the 6 Dhruva Apps Script projects, set `URL`,
   `SERVICE_ROLE_KEY`, `PROJECT`, run `exportToSupabase`, then delete the file).
   Project names: `portal`, `pune-call-tracker`, `pune-incentives`,
   `pune-private-backend`, `hyd-call-tracker`, `hyd-private-backend`.
3. **Vercel environment variables** (Settings → Environment Variables), see
   `.env.example`: TTOP's existing ones (`SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `DB_*`, `VAPID_*`) plus
   `APP_SECRET` (long random text), `PUBLIC_URL` (the Vercel address) and
   `OWNER_EMAIL`.
4. **Google sign-in:** Supabase → Authentication → URL Configuration: the
   Site URL is the Vercel address and `https://<address>/` is in Redirect URLs
   (already the case when you reuse TTOP's project).
5. **Deploy:** push to the Vercel project (Framework preset: *Other*, no build
   command). `vercel.json` sends every request to one function (`api/index.js`)
   and serves only the `public/` folder as static files.
6. **Once-a-minute job:** run `supabase/app_schedule.sql`. Supabase then calls
   `/app/cron` every minute (Dhruva's timed triggers and the shared candidates
   & clients sync), the same way it already calls TTOP's Doc sync. If you
   deployed to a **new** Vercel address, also run
   `supabase/repoint_ttop_schedules.sql` so TTOP's own schedules follow it.
7. On the first request the app adds Dhruva's active users to the Access list
   (Dhruva SUPER_ADMIN → super admin, ADMIN → admin, others → user). Review
   the **Access** page: a super admin of either portal becomes a super admin of both.
8. **Shared candidates & clients:** the sync starts in *report only* mode.
   Open **Shared candidates & clients**, review the numbers, then **Turn sync on**.

`npm install && npm run check && npm start` (Node 20+) still runs the same app
on your own machine for testing, against the same Supabase project.

### How Dhruva runs on Vercel

Vercel starts as many copies of the function as traffic needs and stops them
when idle. Each copy keeps a working copy of Dhruva's data in memory:

- **First request of a new copy** loads Dhruva's data from Supabase (a few
  seconds; about 37,000 rows).
- **Every request** first fetches only what other copies saved since (one
  small call), so everyone sees the latest data.
- **Every save** is checked: if another copy changed the same rows or
  settings in the meantime, the action is undone, refreshed and run again
  automatically, so no change is overwritten unseen. (Google's sheet locks did
  this job before.)
- Dhruva's cache (progress bars, cooldowns) and Script Properties are shared
  through Supabase, so a long operation started on one copy shows its progress
  on every copy.
- **Long operations** (incentive scan, bulk approvals) run on a worker thread
  inside the request, so other requests are not blocked. The incentive scan
  takes about 3-4 minutes. On the Hobby plan a function may run at most
  300 seconds, which this fits but with little margin; on **Pro**, raise
  `maxDuration` in `vercel.json` (e.g. to 800).

## Shared candidates and clients

| Dhruva | TTOP |
|---|---|
| Candidate Master (Interview Portal Control) | `public.candidates` |
| Client Master (Interview Portal Control) | `public.clients` |

- Records are paired with the same rules TTOP's duplicate protection uses
  (names with words in any order for candidates; "Inc/LLC/Group…" ignored for
  clients). Pairing never renames anything.
- After that, every minute (and right after a Dhruva change): new records
  are copied across, and a rename on one side is copied to the other (if both
  were renamed, TTOP's name wins). Deleting a record in one portal does not
  delete it in the other.
- `app_master_links` records which Dhruva ID is which TTOP record.

What to expect when the sync is turned on for the first time: Dhruva's master
holds every student and client (about 1,200 and 500). Those TTOP does not have
are added to TTOP **without a Technical POC**, so they appear in TTOP's
"Unassigned" candidates list, where a Technical POC can claim them. TTOP's
Doc sync and Inbox will also find these candidates by name. Renaming a
candidate changes Dhruva's canonical name too, which Dhruva uses to match
interviews for incentives.

## Notes

- TTOP's service worker (`/sw.js`) is registered by TTOP for the whole site,
  as before; it only caches pages for offline use and never `/api/`.
- TTOP's phone alerts open `/#i<id>`; the home page forwards those to TTOP.
- The Dhruva-only notes from the earlier conversion still apply (formulas are
  not recalculated, `/sheets` replaces editing the Google Sheets). See
  `docs/DHRUVA.md`.
- Tests: `npm run test:ttop` runs TTOP's own test suite (82 tests).
