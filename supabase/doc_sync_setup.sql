-- =====================================================================
-- TTOP Portal: PART 11 - AUTOMATIC GOOGLE DOC SYNC (6:00 AM and 6:00 PM IST)
-- Run ONCE in the Supabase SQL editor. Safe to re-run. Keeps all existing data.
-- BEFORE RUNNING: replace the two values in the "settings" block at the bottom:
--   YOUR-APP.vercel.app   -> your portal's address
--   YOUR_CRON_SECRET      -> the same text you put in CRON_SECRET on Vercel
-- =====================================================================

-- 1. One row per sync run (shown in the portal header and notifications)
create table if not exists public.sync_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  ok boolean not null,
  added int not null default 0,
  updated int not null default 0,
  skipped int not null default 0,
  new_candidates int not null default 0,
  review int not null default 0,
  failed int not null default 0,
  triggered_by text,
  message text,
  error text
);
alter table public.sync_runs enable row level security;
revoke all on public.sync_runs from anon;
drop policy if exists sync_runs_read on public.sync_runs;
create policy sync_runs_read on public.sync_runs for select to authenticated using (public.is_approved());
create index if not exists sync_runs_at on public.sync_runs (ran_at desc);

-- 2. Every doc line already imported, so a line is imported only once
--    (an interview someone cancels or deletes in the portal is not brought back by the next sync)
create table if not exists public.doc_sync_lines (
  key text primary key,
  interview_id bigint references public.interviews(id) on delete set null,
  first_seen timestamptz not null default now()
);
alter table public.doc_sync_lines enable row level security;   -- no policies: only the server job uses it
revoke all on public.doc_sync_lines from anon, authenticated;

-- 2b. Admin "Auto Sync" page: what happened to each doc line, and in which run
alter table public.doc_sync_lines
  add column if not exists action text,      -- added / rescheduled / updated / already / skipped / failed
  add column if not exists run_at timestamptz;
create index if not exists doc_sync_lines_run on public.doc_sync_lines (run_at desc);
grant select on public.doc_sync_lines to authenticated;
drop policy if exists doc_sync_lines_admin_read on public.doc_sync_lines;
create policy doc_sync_lines_admin_read on public.doc_sync_lines for select to authenticated using (public.is_admin());

-- 3. Schedule: 00:30 UTC = 6:00 AM IST, 12:30 UTC = 6:00 PM IST
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  -- ---------- settings: change these two ----------
  app_url text := 'https://YOUR-APP.vercel.app/api/sync-doc';
  secret  text := 'YOUR_CRON_SECRET';
  -- -------------------------------------------------
  cmd text;
begin
  if app_url like '%YOUR-APP%' or secret = 'YOUR_CRON_SECRET' then
    raise exception 'Edit app_url and secret in doc_sync_setup.sql first';
  end if;
  cmd := format($c$select net.http_get(url := %L, headers := jsonb_build_object('Authorization', %L), timeout_milliseconds := 120000)$c$,
                app_url, 'Bearer ' || secret);
  perform cron.unschedule(jobname) from cron.job where jobname in ('ttop-doc-sync-6am', 'ttop-doc-sync-6pm');
  perform cron.schedule('ttop-doc-sync-6am', '30 0 * * *', cmd);
  perform cron.schedule('ttop-doc-sync-6pm', '30 12 * * *', cmd);
end $$;

-- Check the schedule:            select jobname, schedule, active from cron.job;
-- See the last runs (cron side): select * from cron.job_run_details order by start_time desc limit 10;
-- See the last syncs (app side): select ran_at, ok, added, message, error from sync_runs order by ran_at desc limit 10;
