# Call Pilots rebuild on TTOP: plan (Phase 1)

Branch `callpilots-rebuild`, tag `pre-callpilots-rewrite` (= `f8a951a`, the last commit with the
Apps Script portal). Reference screenshots: `docs/reference-ui/01..05`.

Nothing in this phase changes code or the database. Phase 2 starts after the open questions
(end of this file) are answered.

---

## 1. What I verified in the code

| Claim in the brief | Verified | Notes |
|---|---|---|
| TTOP has the data model (team_members flags, interviews.tool_drive text, call_support_1/2, incentives, closers, import_review, doc_sync_lines, activity_log, app_users) | Yes | `interviews.interview_date/time` are nullable ("Date Pending"); `sort_key` puts times before 06:00 after the evening of the same list day. |
| Amounts ₹100 / ₹500 / ₹2,000 | Yes for progression | `generate_incentives`: Round 1→2 = 100, later = 500, recipient = previous round's `tool_drive`, only if that text is empty or `is_team_name()`. Placement creates **two** rows: `Final + Placed (Tool Drive)` and `Final + Placed (Candidate POC)` (`_placement_incentives`). The handler's "Selection" = the Tool Drive row. |
| Closer-list gate | Yes | `incentives.closer_check` = `Waiting for closer list` / `Not in closer list`; a waiting row cannot be set Paid (`trg_incentive_closer_check`). Also `approval_status` = `Approved` / `Pending Approval` / `Rejected` and `status` = `Pending` / `Paid`. |
| `can_see_interview()` first-name ambiguity | **Yes, confirmed** | A member sees an interview when `split_part(tool_drive,' ',1)` equals their first name: two "Karthik"s see each other's calls. |
| `resolve_recipient()` | Safe | Full name, else first name only when exactly one member has it; otherwise `recipient_member_id` stays null. Call Pilots incentive visibility will use `recipient_member_id`, so ambiguous rows go to nobody but admins (listed as "unassigned"). |
| Parsers to copy | Yes | `bpParse`/`bpp`/`bpFile` (Doc import), `tdParse`/`tdO`/`tdM`/`tdApply` (Tool Drive list), `eodT`, `suggestTD` (inside the `core` block). Only `suggestTD` is in `/* core:start */`; the others use page globals and will be rewritten as pure functions in the new page's core block. |
| pg_cron job | Yes | `supabase/app_schedule.sql` schedules `iop-app-minute` → `/app/cron`. |
| `portals/ttop/.claude/settings.local.json` tracked in git | **No** | It is excluded by the global gitignore; nothing to remove. |
| TTOP tests | 83 now | 82 + `sync-doc-review.test.js` added on 2026-11-25. All must stay green. |
| Migrations "1, 2, 3, 5, 7 only create gs_*" | Not 7 | `000007` raises the service-role statement timeout; TTOP's import also benefits. **Keep 7.** `000006` creates `app_imports`/`app_import_chunks` (Dhruva only) and the admin dashboard functions (keep those). |
| `app_state` only for Dhruva | Yes | Used only by `masters.js` (`masters_sync`) and the Dhruva user seeding (`dhruva_users_seeded`). Drop in Step B. |

## 2. Problems with the brief's design (need your OK)

**P1. TTOP's RLS does not work for Call-Pilots-only people.**
`is_admin()`, `is_approved()` and `my_member_id()` read `profiles.approved/role`, and
`app_apply_ttop_access()` sets `approved = false, removed = true` for anyone whose `app_users.portals`
lacks `ttop`. A handler with access to Call Pilots only would read **nothing** through TTOP's RLS, and an
admin of Call Pilots only would fail `is_admin()`.
**Proposal:** Call Pilots gets its own identity functions, based on `app_users` (not `profiles`):
- `cp_user()` → the caller's `app_users` row from `auth.jwt()->>'email'`, only if `active` and
  `'callpilots' = any(portals)` (super_admin always).
- `cp_is_admin()` → that row has role `admin` or `super_admin`.
- `cp_member_id()` → `team_members.id` whose email equals the login email (exact, lower-case).
The page reads and writes **only through SECURITY DEFINER RPCs** that call these, never TTOP tables
directly. TTOP's policies and functions are untouched, so TTOP behaves exactly as today.

**P2. "Prove own data only by calling REST/RPCs" needs a real Postgres.**
TTOP's tests are JavaScript and regex checks; they cannot run SQL. **Proposal:** add
`@electric-sql/pglite` (Postgres compiled to WASM, runs inside `node --test`, no server) as a
**devDependency**. A test helper loads TTOP's schema + the new migration with a small stub for
Supabase's `auth` schema (`auth.uid()`, `auth.jwt()`) and calls the RPCs as different users. This is real
PL/pgSQL, not a mock. (PostgREST itself is not in the loop; the RPCs are what the page calls, and the
tests also check that `anon`/`authenticated` have no direct grants on the new objects.)

**P3. "Request a reschedule" has no place in TTOP's statuses.** Statuses are Scheduled / Completed /
Cancelled / Rescheduled / Date Pending; `Rescheduled` means "replaced by a new interview row".
**Proposal:** additive columns `interviews.cp_reschedule_requested_at timestamptz`,
`cp_reschedule_note text`; TTOP ignores them; admins see "Reschedule requested" on Assign Interviews and
on the Call Pilots dashboard. Feedback goes into the existing `interviews.feedback` (appended with name
and time) so TTOP shows it too.

## 3. Architecture after the rebuild

```
Browser ── /callpilots/ (portals/callpilots/index.html, static, Supabase JS with the user's JWT)
             └─ supabase.rpc('cp_*')  ── SECURITY DEFINER functions ── TTOP tables (+ few new columns)
Server (server/index.js, slim): sign-in cookie, pageGate, /api/config, static pages,
             /ttop/* and TTOP's api/* (doc sync, inbox, push alerts) unchanged,
             redirects /dhruva/* and /call-pilots/* → /callpilots/
```
No Apps Script runtime, no in-memory store, no workers, no snapshot, no `/app/cron`.

## 4. Step A migration (additive, idempotent): `supabase/migrations/20261125000001_callpilots.sql`

Columns
- `team_members.is_call_pilot boolean not null default false`, `team_members.call_pilot_team text`
- `interviews.tool_drive_member_id bigint references team_members(id) on delete set null` + index
- `interviews.cp_reschedule_requested_at timestamptz`, `interviews.cp_reschedule_note text`

Backfill and sync
- `cp_match_member(text)` → id: exact full name (case/space-insensitive), else unique first name, else null.
- Backfill `tool_drive_member_id` from `tool_drive` once; view `cp_unmatched_tool_drive` (admin RPC) lists
  rows where text is set but the id is null (ambiguous or unknown).
- Trigger `t_interviews_td_member` (BEFORE INSERT/UPDATE OF tool_drive, tool_drive_member_id):
  if only the text changed → set the id by `cp_match_member`; if only the id changed → set the text to
  the member's full name. TTOP keeps writing text and still works; incentive triggers are AFTER triggers
  and keep firing as today.
- Seed `is_call_pilot` / `call_pilot_team` from the old `V2 User Access` / `V2 User Roles` tabs (read
  from `gs_rows` **before** Step B), matched by email; the migration prints who it could not match.

Identity (see P1): `cp_user()`, `cp_is_admin()`, `cp_member_id()`.

Portal id rename `dhruva` → `callpilots`
- Replace the `app_users.portals` check constraint, update rows, update `app_users_normalize()`
  (super_admin → `{ttop,callpilots}`) and `trg_profile_app_access()` (its `'dhruva' = any(...)` test).
  `app_apply_ttop_access()` / `trg_app_users_ttop()` only look at `ttop`: no change.
- `server/app/auth.js`: `PORTALS = ["ttop","callpilots"]`; the Dhruva role ceiling (`CEILING`) is
  removed with `server/app/dhruva.js` in Phase 5.

RPCs (all `security definer`, `set search_path = public`, `revoke all ... from public, anon`,
`grant execute ... to authenticated`; each starts with `cp_user()` and raises if null)

| RPC | Who | What |
|---|---|---|
| `cp_me()` | all | name, role, member id, team, is_admin, list of months that have data |
| `cp_dashboard(p_month date, p_member bigint default null, p_team text default null)` | handler: own only (`p_member` ignored); admin: anyone / team | call tiles (Assigned, Completed, Pending, Rescheduled, Cancelled, Support), today line, incentive tiles, 12-month trend, split, month summary, recent activity |
| `cp_incentives(p_month date, p_member, p_team, p_type, p_status, p_search)` | same | rows with honest status: `Paid` / `Pending` / `Pending approval` / `Waiting for closer list` / `Not in closer list` |
| `cp_my_calls(p_from date, p_to date)` | handler: calls where `tool_drive_member_id` or `call_support_1/2` = me; admin: any member via `p_member` | Today / Tomorrow / This week / Not updated (past, still Scheduled) |
| `cp_update_call(p_id, p_action, p_note)` | handler of that call (Tool Drive) or admin | `complete` / `cancel` / `request_reschedule` / `feedback`; writes `activity_log` |
| `cp_import_interviews(p_rows jsonb)` | admin | one transaction; TTOP's duplicate / reschedule / next-round rules; creates candidates with name + POC only; new clients and roles go to `import_review` like TTOP now does; idempotent via `doc_sync_lines` keys; returns per-row result |
| `cp_assign_tool_drive(p_date date, p_rows jsonb)` | admin | sets `tool_drive_member_id` (trigger fills text); team headings only fill empty assignments, never overwrite; returns per-row result; `activity_log` |
| `cp_members()` | admin | Call Pilots handlers and teams for filters / assignment |

Months: all month logic uses `interview_date` (already the IST list day; 01:30 AM calls belong to the
previous list day) and `(now() at time zone 'Asia/Kolkata')::date` for "today". Month picker: current
month first, then the previous 11 months, plus any older month that has data.

## 5. The new portal: `portals/callpilots/index.html`

One static page, mobile first, same card / KPI look as the screenshots, Indian Rupee formatting
(`₹2,000`, lakh grouping). Pages:

1. **Dashboard** (01, 02): handler sees own; admin gets Team and Handler filters.
2. **Incentives** (03): month, search, type (Round progression / Selection / Candidate POC), status, Clear.
3. **My calls** (04 layout): Today / Tomorrow / This week / Not updated, actions per call.
4. **Add Interviews** (admin, 05): tabs "Google Doc" (paste or upload) and "WhatsApp message"; one
   preview (new / duplicate / reschedule / next round / needs review); "Import all".
5. **Assign Interviews** (admin): paste the Tool Drive list; preview matches, clashes, team-heading
   fallbacks; Apply.

Parsers live in `/* core:start */ ... /* core:end */`; tests in `portals/callpilots/test/` in the
`core.test.js` style. Push alerts: TTOP's `sw.js` / `manifest.json` / `api/push-alerts.js` are reused
(the page registers the same service worker scope under `/callpilots/`).

## 6. Server and super admin home (Phase 5)

- `server/index.js`: remove the Apps Script runtime, store, snapshot load, `/api/run`, `/exec/*`,
  `/sheets`, `/api/sheets/*`, `/app/api/dhruva-session`, `/app/api/profile`, Dhruva parts of
  `/app/cron` (endpoint removed), Server-Timing for Dhruva; add `/callpilots/` + redirects.
  Startup no longer loads 87k rows; expected cold start well under a second.
- `public/app.html`: keep TTOP tiles and People; replace Call Pilots widgets (data import, setup,
  masters, handler tables) with numbers from `cp_dashboard` (admin, all teams).
- `vercel.json`: `memory` 2048 → 1024, `maxDuration` 300 → 60 (TTOP doc sync uses ≤60 s).
- `package.json` scripts: `test` = TTOP + Call Pilots tests; `check` rewritten.

## 7. Step B (destructive, separate, only after your sign-off)

`supabase/migrations/20261126000001_callpilots_archive.sql`
- `create schema archive_dhruva`; `alter table ... set schema archive_dhruva` for all `gs_*` tables and
  the 60 generated views (views move with their names; nothing dropped).
- `cron.unschedule('iop-app-minute')`.
- Drop: `app_master_links`, `app_imports`, `app_import_chunks`, `app_state`, functions `gs_*`,
  `app_pending_signups` stays (used by People).

`supabase/drop_archive_dhruva_AFTER_SIGNOFF.sql`: `drop schema archive_dhruva cascade` (run later by you).
One-command export before that: `pg_dump --schema=archive_dhruva` (command in the file header).

### Files to DELETE (Step B commit)
```
portals/dhruva/                        (161 files: 6 Apps Script projects + Working Portal.html)
server/gas/format.js  server/gas/services.js  server/gas/spreadsheet.js
server/runtime.js  server/store.js  server/persistence.js  server/snapshot.js  server/worker.js
server/gas-client.js  server/ui.js
server/app/dhruva.js  server/app/masters.js  server/app/csvimport.js
public/sheets.html
config/projects.json  config/tab-profiles.json
tools/SupabaseExport.gs  tools/build-tab-profiles.js
test/csv_roundtrip.js
docs/DHRUVA.md
supabase/migrations/20261124000001_dhruva_store.sql
supabase/migrations/20261124000002_dhruva_views.sql
supabase/migrations/20261124000003_dhruva_import_helpers.sql
supabase/migrations/20261124000005_multi_instance.sql
supabase/app_schedule.sql              (replaced by the unschedule in Step B)

```

### Files to KEEP (changed where noted)
```
portals/ttop/**                        unchanged (except the .claude file above)
api/index.js                           bundle hints trimmed
server/index.js                        slimmed (section 6)
server/app/auth.js                     PORTALS rename, no Dhruva ceiling
server/app/ttop.js                     unchanged
server/app/admin.js                    Dhruva figures replaced by cp_dashboard
public/app.html                        Call Pilots widgets replaced
scripts/check.js                       rewritten (no Apps Script projects)
supabase/migrations/20261124000004_combined_app.sql   done: callpilots id; app_master_links/app_state removed
supabase/migrations/20261124000006_admin_dashboard.sql done: app_imports parts removed
DELETED too: 20261124000007_server_timeout.sql (Dhruva CSV only; 60 s set in callpilots.sql), repoint_ttop_schedules.sql (address unchanged)
package.json, vercel.json, .env.example, README.md     updated
docs/reference-ui/*                    kept
NEW: portals/callpilots/index.html, portals/callpilots/test/*, supabase/migrations/20261125000001_callpilots.sql,
     test/db/ (PGlite helper + RLS/RPC tests), docs/CALLPILOTS_PLAN.md
```

### Tables after Step B
Kept: every TTOP table, `app_users`. Added columns only (section 4).
Moved to `archive_dhruva`: `gs_workbooks, gs_sheets, gs_rows, gs_script_properties, gs_triggers,
gs_export_log, gs_counter, gs_cache` + 60 views. Dropped: `app_master_links, app_imports,
app_import_chunks, app_state`.

## 8. Tests and checks per phase

- `npm run test:ttop` (83) green after every phase.
- New: `portals/callpilots/test/core.test.js` (Doc + WhatsApp + Tool Drive parsers, IST list day,
  month list, ₹ format), `test/db/*.test.js` on PGlite:
  handler A cannot read B's calls / incentives / dashboard via any RPC; two "Karthik"s isolated;
  non-admin gets an error from `cp_import_interviews` / `cp_assign_tool_drive`; import and assign run twice
  create nothing new; 01:30 call stays on the previous list day; month boundaries in IST;
  no new table without RLS; `anon` has no execute on `cp_*`.
- Secrets: grep for service keys in browser files; `settings.local.json` untracked.
- Supabase advisors (security + performance) after each migration on the **test project / branch**
  (needs your Supabase access; I cannot reach it from here).

## 9. Phases (one commit each, stop for review)

1. **This plan** (done).
2. Step A migration + RPCs + PGlite DB tests.
3. Portal pages 1–3 (Dashboard, Incentives, My calls).
4. Pages 4–5 (Add Interviews with Doc + WhatsApp, Assign Interviews).
5. Server + `app.html` cleanup, redirects, vercel.json, README.
6. Step B (archive + delete), after your sign-off on the new portal.

## 10. Open questions (defaults in bold)

1. Old "Selection incentive (₹2,000)" = TTOP Placed? **Yes: Selected ⇒ Placed, shown as "Selection".**
2. Old incentive history inside the new Incentives page? **No: archived + CSV export only.**
3. Handlers report "Selected" with admin confirmation? **No: admins mark Placed in TTOP.**
4. Per-team filters and totals for admins (Pradeep Anna, HYD)? **Yes.**
5. Old auto-scheduler (availability, leave, night balance, optimizer)? **No: manual Tool Drive list.**
6. TTOP phone alerts 10 minutes before a call for handlers? **Yes: reuse push alerts.**
7. (P1) Call Pilots identity from `app_users` + RPC-only access instead of TTOP's RLS? **Yes.**
8. (P2) Add `@electric-sql/pglite` as a devDependency for real SQL tests? **Yes.**
9. (P3) "Request reschedule" as a flag on the interview that admins act on? **Yes.**
10. WhatsApp sample: if none is given I assume the export format
    `[10:42 am, 25/11/2026] Name: text` (also `25/11/2026, 10:42 - Name: text` from "Export chat"),
    `*bold*` / `_italic_` / `~strike~` markers removed, numbered lines `1.` / `1)` stripped, and each
    remaining line in the same shape as a Google Doc line. **A real sample would be better.**
