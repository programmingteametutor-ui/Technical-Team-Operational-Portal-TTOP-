-- =====================================================================
-- TTOP Portal: TURN ON the automatic Google Doc sync (6:00 AM and 6:00 PM IST)
-- Supabase > SQL Editor > New query > paste this whole file > change the 2 lines marked ⬇ > Run
-- Safe to run again (it replaces the old schedule).
-- =====================================================================

-- Tables the sync writes to (skipped if they already exist)
create table if not exists public.sync_runs (
  id bigint generated always as identity primary key, ran_at timestamptz not null default now(), ok boolean not null,
  added int not null default 0, updated int not null default 0, skipped int not null default 0, new_candidates int not null default 0,
  review int not null default 0, failed int not null default 0, triggered_by text, message text, error text);
alter table public.sync_runs enable row level security;
drop policy if exists sync_runs_read on public.sync_runs;
create policy sync_runs_read on public.sync_runs for select to authenticated using (public.is_approved());
create table if not exists public.doc_sync_lines (key text primary key, interview_id bigint references public.interviews(id) on delete set null, first_seen timestamptz not null default now());
alter table public.doc_sync_lines add column if not exists action text, add column if not exists run_at timestamptz;
alter table public.doc_sync_lines enable row level security;
grant select on public.doc_sync_lines to authenticated;
drop policy if exists doc_sync_lines_admin_read on public.doc_sync_lines;
create policy doc_sync_lines_admin_read on public.doc_sync_lines for select to authenticated using (public.is_admin());

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  -- ⬇ 1. Your portal address (the one you open in the browser) + /api/sync-doc
  app_url text := 'https://YOUR-APP.vercel.app/api/sync-doc';
  -- ⬇ 2. Exactly the same text as CRON_SECRET in Vercel > Settings > Environment Variables
  secret  text := 'YOUR_CRON_SECRET';
  cmd text;
begin
  if app_url like '%YOUR-APP%' or secret = 'YOUR_CRON_SECRET' then
    raise exception 'Change the two lines marked ⬇ (portal address and CRON_SECRET), then run again';
  end if;
  cmd := format($c$select net.http_get(url := %L, headers := jsonb_build_object('Authorization', %L), timeout_milliseconds := 120000)$c$,
                app_url, 'Bearer ' || secret);
  perform cron.unschedule(jobname) from cron.job where jobname in ('ttop-doc-sync-6am', 'ttop-doc-sync-6pm');
  perform cron.schedule('ttop-doc-sync-6am', '30 0 * * *', cmd);   -- 00:30 UTC = 6:00 AM IST
  perform cron.schedule('ttop-doc-sync-6pm', '30 12 * * *', cmd);  -- 12:30 UTC = 6:00 PM IST
  execute cmd;                                                      -- one test sync right now
end $$;

-- You should see 2 rows, both active = true
select jobname, schedule, active from cron.job where jobname like 'ttop-doc-sync%';

-- =====================================================================
-- WAIT ~30 SECONDS, then select ONLY the line below and click Run.
-- status_code 200 = working. Anything else: copy the row and send it.
-- =====================================================================
-- select status_code, left(content::text, 300) as reply, created from net._http_response order by id desc limit 1;
