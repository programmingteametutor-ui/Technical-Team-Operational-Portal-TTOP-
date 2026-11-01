-- =====================================================================
-- TTOP Portal: fetch recruiter emails into the Interview Inbox automatically, EVERY 4 HOURS
-- (6:15 AM, 10:15 AM, 2:15 PM, 6:15 PM, 10:15 PM and 2:15 AM IST)
-- Supabase > SQL Editor > paste this whole file > Run. Safe to run again (it replaces the old schedule).
--
-- You normally do NOT need to change anything: the portal address and CRON_SECRET are copied from the
-- Google Doc auto-sync schedule (turn_on_auto_sync.sql). If that schedule does not exist, fill in the 2 lines marked ⬇.
-- Run interview_inbox.sql first.
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  -- ⬇ only needed if the doc auto-sync is not set up: portal address + /api/interview-inbox/refresh
  app_url text := 'https://YOUR-APP.vercel.app/api/interview-inbox/refresh';
  -- ⬇ only needed if the doc auto-sync is not set up: same text as CRON_SECRET in Vercel
  secret  text := 'YOUR_CRON_SECRET';
  old text; cmd text;
begin
  if app_url like '%YOUR-APP%' or secret = 'YOUR_CRON_SECRET' then
    select command into old from cron.job where jobname = 'ttop-doc-sync-6am';
    if old is null then
      raise exception 'Fill in the two lines marked ⬇ (portal address and CRON_SECRET), then run again';
    end if;
    app_url := regexp_replace(substring(old from 'url := ''([^'']+)'''), '/api/sync-doc.*$', '/api/interview-inbox/refresh');
    secret  := substring(old from 'Bearer ([^'']+)''');
    if app_url is null or secret is null then
      raise exception 'Could not read the address / secret from the doc sync schedule. Fill in the two lines marked ⬇';
    end if;
  end if;
  cmd := format($c$select net.http_post(url := %L, body := '{}'::jsonb, headers := jsonb_build_object('Authorization', %L, 'Content-Type', 'application/json'), timeout_milliseconds := 60000)$c$,
                app_url, 'Bearer ' || secret);
  perform cron.unschedule(jobname) from cron.job where jobname = 'ttop-inbox-fetch-4h';
  perform cron.schedule('ttop-inbox-fetch-4h', '45 0,4,8,12,16,20 * * *', cmd);   -- UTC; = 6:15, 10:15, 14:15, 18:15, 22:15, 02:15 IST
  execute cmd;                                                                     -- one fetch right now
  raise notice 'Scheduled every 4 hours: %', app_url;
end $$;

-- You should see 1 row, active = true
select jobname, schedule, active from cron.job where jobname = 'ttop-inbox-fetch-4h';

-- =====================================================================
-- WAIT ~30 SECONDS, then select ONLY the line below and click Run.
-- status_code 200 = working. Anything else: copy the row and send it.
-- =====================================================================
-- select status_code, left(content::text, 300) as reply, created from net._http_response order by id desc limit 1;
