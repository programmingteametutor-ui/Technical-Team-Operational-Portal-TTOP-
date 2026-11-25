# Interview Operations Portal (TTOP + Call Pilots)

One app that hosts two portals with one Google sign-in, one Supabase database
(TTOP's tables) and one set of roles.

- **TTOP Portal** (`portals/ttop/`): the technical team's portal, unchanged.
  Its page is served byte-for-byte and its API functions run as they did on
  Vercel. Its data is protected by TTOP's own row-level security.
- **Call Pilots Operations Portal** (`portals/callpilots/`, being rebuilt): the
  portal where the Pradeep Anna Team and the HYD team drive interview calls.
  It works on TTOP's interviews and incentives: a Call Pilots handler is the
  interview's **Tool Drive**. Every read and write goes through the `cp_*` SQL
  functions in `supabase/migrations/20261125000001_callpilots.sql`.
  The old Apps Script version is kept at the git tag `pre-callpilots-rewrite`.
  Plan and status: `docs/CALLPILOTS_PLAN.md`.

```
 /             home: Google sign-in; super admin Dashboard and People
 /ttop/        TTOP Portal   (+ /api/config, /api/sync-doc, /api/interview-inbox…, /api/push-alerts, /sw.js, /manifest.json, /icons/…)
 /callpilots/  Call Pilots   (old /dhruva/ and /call-pilots/ links redirect here)
```

## Roles

| Role | Portals | TTOP | Call Pilots |
|---|---|---|---|
| **Super admin** | Both | Admin | Admin: everyone's data, Add and Assign Interviews |
| **Admin** | The ones ticked | Admin | Admin |
| **User** | The ones ticked | Sees their own candidates | Handler: only their own calls and incentives |

How it is enforced:
- **Entry:** the server checks `app_users` before serving `/ttop/` or `/callpilots/`.
- **TTOP:** the People list writes TTOP's own approval/admin flags through
  database triggers, so TTOP's RLS enforces it even for direct Supabase calls.
- **Call Pilots:** every `cp_*` function checks the caller's `app_users` row
  (from the login email in the Supabase JWT): handlers get their own rows only
  (matched by `interviews.tool_drive_member_id`, never by first name); admin-only
  functions refuse other callers. Nothing is granted to `anon`.

## Super admin home

- **Dashboard:** one click into each portal; today's TTOP interviews and Call
  Pilots calls per team; reschedule requests and calls not updated; incentives
  this month per team and handler; recent activity from both portals.
- **People:** everyone with access, role, portals and last sign-in; people who
  signed in with Google but have no access yet (give access or block).

## Setup

Use **TTOP's existing Supabase project**. Do **not** run TTOP's
`reset_and_setup_DELETES_ALL_DATA.sql` on it: that file wipes the database.

1. **Database** (Supabase → SQL Editor, on a test project or branch first), in order:
   `20261124000004_combined_app.sql`, `20261124000006_admin_dashboard.sql`
   (both already run on the live project), then `20261125000001_callpilots.sql`.
   The last one only adds columns and functions, renames the portal id
   `dhruva` → `callpilots`, and marks Call Pilots handlers from the old user
   list (read the notice for anyone it could not match).
2. **Vercel environment variables** (see `.env.example`): TTOP's
   (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `CRON_SECRET`, `DB_*`, `VAPID_*`) plus `APP_SECRET`, `PUBLIC_URL`,
   `SUPER_ADMIN_EMAILS`.
3. **Google sign-in:** Supabase → Authentication → URL Configuration: the Site
   URL is the Vercel address and `https://<address>/` is in Redirect URLs.
4. **Deploy** to Vercel (Framework preset *Other*, no build command).
   `vercel.json` sends every request to `api/index.js` (Mumbai region).
5. **TTOP's schedules** (doc sync, inbox, phone alerts) keep running unchanged.
6. **After you sign off on the new Call Pilots portal:** run
   `supabase/migrations/20261126000001_callpilots_archive.sql`. It moves the old
   Apps Script data (`gs_*`) into the schema `archive_dhruva` (nothing deleted),
   unschedules the old every-minute job `iop-app-minute`, and drops the
   Dhruva-only app tables. Delete the archive later with
   `supabase/drop_archive_dhruva_AFTER_SIGNOFF.sql`.

`npm install && npm run check && npm start` runs the same app locally against
the same Supabase project.

## Tests

`npm test` runs TTOP's test suite (`portals/ttop/test`).
