-- =====================================================================
-- TTOP Portal: live updates (changes made by others appear without reloading the page)
-- Supabase > SQL Editor > paste > Run. Safe on the live database and safe to run again.
-- It only turns on Supabase Realtime for these tables. Row-level security still applies:
-- each person only receives changes to rows they are allowed to see.
-- =====================================================================
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['interviews','candidates','assessments','clients','team_members','incentives','closers','import_review','sync_runs','profiles'] loop
    if to_regclass('public.' || t) is not null and not exists (
         select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Check: the tables that now send live updates
select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' order by 1;
