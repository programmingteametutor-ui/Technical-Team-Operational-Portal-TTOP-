-- =====================================================================
-- Call Pilots rebuild, Step B: ARCHIVE the old Apps Script data
--
-- Run ONLY after you have signed off on the new Call Pilots portal, and only
-- after 20261125000001_callpilots.sql (it seeds Call Pilots members from the
-- old user list, which this file moves away).
--
-- Nothing is deleted from your data: every gs_* table and its 60 generated
-- views move into the schema archive_dhruva. Export them any time with
--   pg_dump "$SUPABASE_DB_URL" --schema=archive_dhruva --no-owner -f archive_dhruva.sql
-- and drop them later with supabase/drop_archive_dhruva_AFTER_SIGNOFF.sql.
--
-- The gs_* functions move to the archive too (the archived views use gs_cell).
-- Dropped here (Dhruva-only, no business data): the every-minute job
-- iop-app-minute, app_master_links, app_imports, app_import_chunks, app_state.
-- Safe to run again.
-- =====================================================================

create schema if not exists archive_dhruva;
revoke all on schema archive_dhruva from public, anon, authenticated;

-- 1. The every-minute job that called /app/cron (that endpoint no longer exists)
do $$
begin
  if to_regclass('cron.job') is not null then
    perform cron.unschedule(jobid) from cron.job where jobname = 'iop-app-minute';
  end if;
end $$;

-- 2. Views on gs_* (the generated per-tab views) -> archive_dhruva
do $$
declare v record;
begin
  for v in
    select distinct c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_depend d on d.objid in (select oid from pg_rewrite where ev_class = c.oid)
      join pg_class t on t.oid = d.refobjid
     where n.nspname = 'public' and c.relkind = 'v' and t.relname like 'gs\_%'
  loop
    execute format('alter view public.%I set schema archive_dhruva', v.relname);
  end loop;
end $$;

-- 3. gs_* tables -> archive_dhruva
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'gs\_%' loop
    execute format('alter table public.%I set schema archive_dhruva', t.tablename);
  end loop;
end $$;

-- 4. gs_* functions -> archive_dhruva too (the archived views use gs_cell; never drop with cascade)
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'gs\_%' loop
    execute format('alter function %s set schema archive_dhruva', f.sig);
  end loop;
end $$;

-- 5. Dhruva-only app tables and functions
drop table if exists public.app_master_links;
drop table if exists public.app_import_chunks;
drop table if exists public.app_imports;
drop table if exists public.app_state;

-- Check: nothing gs_* left in public; what is in the archive
select 'public gs_* objects left' as check, count(*)::text as value
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname like 'gs\_%'
union all
select 'archive_dhruva tables', count(*)::text from pg_tables where schemaname = 'archive_dhruva'
union all
select 'archive_dhruva views', count(*)::text from pg_views where schemaname = 'archive_dhruva'
union all
select 'iop-app-minute job', case when to_regclass('cron.job') is null then 'no pg_cron'
       else (select count(*)::text from cron.job where jobname = 'iop-app-minute') end;
