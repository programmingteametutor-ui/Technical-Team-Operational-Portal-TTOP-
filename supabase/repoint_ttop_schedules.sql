-- =====================================================================
-- TTOP's scheduled jobs (Doc sync 6 AM / 6 PM, Inbox fetch every 4 h, phone alerts every 5 min)
-- call the portal's address. TTOP now runs inside the combined app, so point them at the new address.
-- Supabase > SQL Editor > change the line marked ⬇ > Run. Safe to run again. Nothing else changes.
-- =====================================================================
do $$
declare
  -- ⬇ the combined app's address (same as PUBLIC_URL), no trailing slash
  new_base text := 'https://YOUR-NEW-ADDRESS';
  j record; cmd text;
begin
  if new_base like '%YOUR-NEW-ADDRESS%' then raise exception 'Put the new address in new_base first'; end if;
  for j in select jobid, jobname, command from cron.job where jobname like 'ttop-%' loop
    cmd := regexp_replace(j.command, 'url := ''https?://[^/'']+', 'url := ''' || new_base, 'g');
    if cmd <> j.command then
      perform cron.alter_job(job_id := j.jobid, command := cmd);
      raise notice 'Updated %', j.jobname;
    end if;
  end loop;
end $$;

-- Check: every TTOP job now calls the new address
select jobname, schedule, active, substring(command from 'url := ''([^'']+)''') as calls from cron.job where jobname like 'ttop-%' order by jobname;
