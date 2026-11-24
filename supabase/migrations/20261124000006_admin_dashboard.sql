-- =====================================================================
-- Super admin dashboard: TTOP figures, sign-up requests, CSV imports.
-- Safe to run more than once. Changes no TTOP or Dhruva table except
-- adding last_login_at to app_users.
-- =====================================================================

alter table public.app_users add column if not exists last_login_at timestamptz;

-- One row per CSV file imported into a Dhruva tab
create table if not exists public.app_imports (
  id             bigint generated always as identity primary key,
  at             timestamptz not null default now(),
  by_email       text,
  file_name      text,
  spreadsheet_id text not null,
  tab            text not null,
  rows_in        int not null default 0,
  rows_before    int not null default 0,
  dates          int not null default 0,
  numbers        int not null default 0,
  note           text
);
create index if not exists app_imports_tab on public.app_imports (spreadsheet_id, tab, at desc);

-- Large CSV files arrive in parts (Vercel takes at most 4.5 MB per request)
create table if not exists public.app_import_chunks (
  import_id  text not null,
  n          int not null,
  rows       jsonb not null,
  created_at timestamptz not null default now(),
  primary key (import_id, n)
);

alter table public.app_imports       enable row level security;
alter table public.app_import_chunks enable row level security;
revoke all on public.app_imports, public.app_import_chunks from anon, authenticated;

-- ---------------------------------------------------------------------
-- People who signed in with Google but have no portal access yet
-- ---------------------------------------------------------------------
create or replace function public.app_pending_signups()
returns jsonb language sql stable security definer set search_path = public, auth as $$
  select coalesce(jsonb_agg(x order by x->>'signed_up' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'email', lower(u.email),
      'name', coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', ''),
      'signed_up', u.created_at
    ) x
    from auth.users u
    where u.email is not null
      and not exists (select 1 from app_users a where a.email = lower(btrim(u.email)))
  ) s
$$;

-- ---------------------------------------------------------------------
-- TTOP figures for the dashboard (p_today = today's date in India)
-- ---------------------------------------------------------------------
create or replace function public.app_dashboard_ttop(p_today date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  m0 date := date_trunc('month', p_today)::date;
  out jsonb := '{}'::jsonb;
begin
  out := out || jsonb_build_object(
    'today', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'time', to_char(i.interview_time, 'HH24:MI'), 'candidate', c.name, 'client', cl.name,
        'round', i.round, 'type', i.interview_type, 'status', i.interview_status, 'prep', i.prep_status,
        'support', concat_ws(', ', s1.name, s2.name)) order by i.sort_key), '[]'::jsonb)
      from interviews i
      join candidates c on c.id = i.candidate_id
      join clients cl on cl.id = i.client_id
      left join team_members s1 on s1.id = i.call_support_1
      left join team_members s2 on s2.id = i.call_support_2
      where i.interview_date = p_today and i.interview_status <> 'Rescheduled'),
    'counts', jsonb_build_object(
      'today', (select count(*) from interviews where interview_date = p_today and interview_status <> 'Rescheduled'),
      'today_done', (select count(*) from interviews where interview_date = p_today and interview_status = 'Completed'),
      'next7', (select count(*) from interviews where interview_date > p_today and interview_date <= p_today + 7 and interview_status = 'Scheduled'),
      'prep_pending', (select count(*) from interviews where interview_date between p_today and p_today + 2 and interview_status = 'Scheduled' and prep_status <> 'Done'),
      'month', (select count(*) from interviews where interview_date >= m0 and interview_date <= p_today and interview_status = 'Completed'),
      'placed_month', (select count(*) from interviews where placement_status = 'Placed' and interview_date >= m0),
      'candidates', (select count(*) from candidates where active),
      'clients', (select count(*) from clients),
      'incentive_pending', (select count(*) from incentives where status = 'Pending'),
      'incentive_pending_amt', (select coalesce(sum(amount), 0) from incentives where status = 'Pending'),
      'incentive_month_amt', (select coalesce(sum(amount), 0) from incentives where event_date >= m0)
    ),
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'n',
        (select count(*) from interviews where interview_date = d::date and interview_status <> 'Rescheduled')) order by d), '[]'::jsonb)
      from generate_series(p_today - 13, p_today, interval '1 day') d),
    'activity', (
      select coalesce(jsonb_agg(a order by a->>'at' desc), '[]'::jsonb) from (
        select jsonb_build_object('at', at, 'who', coalesce(actor_name, actor_email), 'action', action, 'entity', entity) a
        from activity_log order by at desc limit 12) z)
  );
  -- optional TTOP tables (present on current TTOP versions)
  begin
    out := jsonb_set(out, '{counts,closers_month}', to_jsonb((select count(*) from closers where closer_month = date_trunc('month', p_today)::date)));
  exception when undefined_table then null; end;
  begin
    out := jsonb_set(out, '{counts,import_review}', to_jsonb((select count(*) from import_review)));
  exception when undefined_table then null; end;
  begin
    out := jsonb_set(out, '{counts,expected_open}', to_jsonb((select count(*) from expected_placements where status = 'open')));
  exception when undefined_table then null; end;
  begin
    out := out || jsonb_build_object('last_sync', (select to_jsonb(r) from (select ran_at, ok, added, updated, review, failed, message, error from sync_runs order by ran_at desc limit 1) r));
  exception when undefined_table then null; end;
  return out;
end $$;

revoke all on function public.app_pending_signups() from public, anon, authenticated;
revoke all on function public.app_dashboard_ttop(date) from public, anon, authenticated;
grant execute on function public.app_pending_signups() to service_role;
grant execute on function public.app_dashboard_ttop(date) to service_role;
