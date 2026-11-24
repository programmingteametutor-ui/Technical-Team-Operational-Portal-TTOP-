-- =====================================================================
-- Interview Operations Portal: the once-a-minute job (Dhruva's timed triggers and
-- the shared candidates & clients sync). On Vercel nothing runs between requests,
-- so Supabase calls the app every minute, the same way it already calls TTOP's
-- Doc sync, Inbox fetch and phone alerts.
-- Supabase > SQL Editor > change the 2 lines marked ⬇ > Run. Safe to run again.
-- (If TTOP's Doc sync schedule exists, the address and secret are taken from it.)
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  -- ⬇ the app's address (Vercel domain), no trailing slash
  base   text := 'https://YOUR-APP.vercel.app';
  -- ⬇ the same text as CRON_SECRET in Vercel > Settings > Environment Variables
  secret text := 'YOUR_CRON_SECRET';
  old text; cmd text;
begin
  if base like '%YOUR-APP%' or secret = 'YOUR_CRON_SECRET' then
    select command into old from cron.job where jobname = 'ttop-doc-sync-6am';
    if old is null then raise exception 'Fill in the two lines marked ⬇ first'; end if;
    base   := regexp_replace(substring(old from 'url := ''([^'']+)'''), '/api/sync-doc.*$', '');
    secret := substring(old from 'Bearer ([^'']+)''');
  end if;
  cmd := format($c$select net.http_post(url := %L, body := '{}'::jsonb, headers := jsonb_build_object('Authorization', %L, 'Content-Type', 'application/json'), timeout_milliseconds := 290000)$c$,
                base || '/app/cron', 'Bearer ' || secret);
  perform cron.unschedule(jobname) from cron.job where jobname = 'iop-app-minute';
  perform cron.schedule('iop-app-minute', '* * * * *', cmd);
  raise notice 'Every minute: %/app/cron', base;
end $$;

select jobname, schedule, active from cron.job where jobname = 'iop-app-minute';
