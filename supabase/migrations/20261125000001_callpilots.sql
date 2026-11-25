-- =====================================================================
-- Call Pilots Operations Portal on TTOP's tables  (Step A: additive only)
--
-- Run on a Supabase TEST project / branch first:
--   Supabase > SQL Editor > New query > paste this whole file > Run.
-- Safe to run again. Changes no existing TTOP behaviour:
--   * only ADDS columns, functions, a trigger and indexes;
--   * renames the portal id 'dhruva' -> 'callpilots' in app_users;
--   * does not touch TTOP's RLS policies or functions.
--
-- How access works (see docs/CALLPILOTS_PLAN.md, P1)
--   TTOP's RLS reads profiles.approved, which is FALSE for people who have
--   Call Pilots access only. So the Call Pilots page never reads TTOP tables
--   directly: it calls the cp_* functions below (SECURITY DEFINER), which
--   check the caller's app_users row (from the login email in the JWT):
--     cp_role()      'super_admin' | 'admin' | 'user' | null (no access)
--     cp_member_id() the caller's team_members row (same email)
--   Handlers ('user') get their own data only; admins get everyone.
--
-- Handler = the interview's Tool Drive. Calls are matched by the new
-- interviews.tool_drive_member_id (exact), not by first name.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Columns and indexes
-- ---------------------------------------------------------------------
alter table public.team_members add column if not exists is_call_pilot boolean not null default false;
alter table public.team_members add column if not exists call_pilot_team text;

alter table public.interviews add column if not exists tool_drive_member_id bigint
  references public.team_members(id) on delete set null;
alter table public.interviews add column if not exists cp_reschedule_requested_at timestamptz;
alter table public.interviews add column if not exists cp_reschedule_note text;

create index if not exists interviews_td_member on public.interviews (tool_drive_member_id, interview_date);
create index if not exists interviews_cs1_date  on public.interviews (call_support_1, interview_date);
create index if not exists interviews_cs2_date  on public.interviews (call_support_2, interview_date);
create index if not exists interviews_list_day  on public.interviews (interview_date);
create index if not exists incentives_recipient on public.incentives (recipient_member_id, event_date);


-- ---------------------------------------------------------------------
-- 2. Small helpers
-- ---------------------------------------------------------------------
-- Text without HTML characters (TTOP's tables refuse < and >), spaces collapsed
create or replace function public.cp_clean(t text) returns text
language sql immutable parallel safe as $$
  select nullif(btrim(regexp_replace(replace(replace(coalesce(t, ''), '<', ''), '>', ''), '\s+', ' ', 'g')), '') $$;

-- Role key: lower case, "(...)" tail removed (same as TTOP's rn())
create or replace function public.cp_role_key(t text) returns text
language sql immutable parallel safe as $$
  select btrim(regexp_replace(lower(regexp_replace(coalesce(t, ''), '\(.*$', '')), '\s+', ' ', 'g')) $$;

-- Today's list day in India: until 06:00 IST it is still the previous day's list
-- (a 01:30 AM call belongs to the evening list before it, like TTOP's sort_key).
create or replace function public.cp_list_today() returns date
language sql stable as $$ select ((now() at time zone 'Asia/Kolkata') - interval '6 hours')::date $$;

-- Team member for a Tool Drive text: exact full name, else a first name that only
-- one member has. Two "Karthik"s -> null (never guessed).
create or replace function public.cp_match_member(p text) returns bigint
language sql stable security definer set search_path = public as $$
  with n as (select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')) as v)
  select coalesce(
    (select min(tm.id) from team_members tm, n
      where n.v <> '' and lower(regexp_replace(btrim(tm.name), '\s+', ' ', 'g')) = n.v
     having count(*) = 1),
    (select min(tm.id) from team_members tm, n
      where n.v <> '' and position(' ' in n.v) = 0 and lower(split_part(btrim(tm.name), ' ', 1)) = n.v
     having count(*) = 1)) $$;
revoke all on function public.cp_match_member(text) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. tool_drive text <-> tool_drive_member_id stay in step
--    TTOP keeps writing the text (id follows); Call Pilots writes both.
--    BEFORE trigger: TTOP's AFTER triggers (incentives, closers) keep firing
--    exactly as today, because they depend on the UPDATE's own column list.
-- ---------------------------------------------------------------------
create or replace function public.trg_interviews_td_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.tool_drive_member_id is not null then
      new.tool_drive := (select name from team_members where id = new.tool_drive_member_id);
    else
      new.tool_drive_member_id := public.cp_match_member(new.tool_drive);
    end if;
  elsif new.tool_drive_member_id is distinct from old.tool_drive_member_id then
    if new.tool_drive_member_id is not null then
      new.tool_drive := (select name from team_members where id = new.tool_drive_member_id);
    elsif new.tool_drive is not distinct from old.tool_drive then
      new.tool_drive := null;                                   -- unassigned by id
    end if;
  elsif new.tool_drive is distinct from old.tool_drive then
    new.tool_drive_member_id := public.cp_match_member(new.tool_drive);
  end if;
  return new;
end $$;
drop trigger if exists t_interviews_td_member on public.interviews;
create trigger t_interviews_td_member before insert or update of tool_drive, tool_drive_member_id
  on public.interviews for each row execute function public.trg_interviews_td_member();

-- Backfill once (only the new column: no incentive / closer trigger fires)
update public.interviews i
   set tool_drive_member_id = public.cp_match_member(i.tool_drive)
 where i.tool_drive_member_id is null and coalesce(btrim(i.tool_drive), '') <> ''
   and public.cp_match_member(i.tool_drive) is not null;


-- ---------------------------------------------------------------------
-- 4. Portal id: 'dhruva' -> 'callpilots'
-- ---------------------------------------------------------------------
alter table public.app_users drop constraint if exists app_users_portals_check;

create or replace function public.app_users_normalize() returns trigger
language plpgsql set search_path = public as $$
begin
  new.email := lower(btrim(new.email));
  if new.role = 'super_admin' then new.portals := array['callpilots','ttop'];
  else new.portals := array(select distinct p from unnest(coalesce(new.portals, '{}')) p order by p);
  end if;
  new.updated_at := now();
  return new;
end $$;

update public.app_users set portals = array_replace(portals, 'dhruva', 'callpilots')
 where 'dhruva' = any(portals);

alter table public.app_users add constraint app_users_portals_check
  check (portals <@ array['ttop','callpilots']::text[]);

-- same as before, only 'dhruva' -> 'callpilots' (an admin of Call Pilots keeps admin)
create or replace function public.trg_profile_app_access() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.applying_access', true) = 'on' then return new; end if;
  if exists (select 1 from app_users where email = lower(btrim(new.email))) then
    if tg_op = 'INSERT' then
      perform public.app_apply_ttop_access(new.email);
    else
      update app_users a set
        portals = case
          when new.approved and not new.removed then array(select distinct p from unnest(a.portals || array['ttop']) p)
          else array_remove(a.portals, 'ttop') end,
        role = case
          when a.role = 'super_admin' then 'super_admin'
          when new.approved and not new.removed and new.role = 'admin' then 'admin'
          when new.approved and not new.removed and new.role = 'user' and a.role = 'admin' and not ('callpilots' = any(a.portals)) then 'user'
          else a.role end,
        updated_by = coalesce((select auth.jwt() ->> 'email'), 'ttop')
      where a.email = lower(btrim(new.email));
      perform public.app_apply_ttop_access(new.email);
    end if;
  elsif new.approved and not coalesce(new.removed, false) then
    insert into app_users (email, name, role, portals, updated_by)
    values (lower(btrim(new.email)), new.name, case when new.role = 'admin' then 'admin' else 'user' end, array['ttop'], 'ttop')
    on conflict (email) do nothing;
  end if;
  return new;
end $$;


-- ---------------------------------------------------------------------
-- 5. Who is calling (Call Pilots access comes from app_users, not profiles)
-- ---------------------------------------------------------------------
create or replace function public.cp_email() returns text
language sql stable as $$ select lower(btrim(coalesce((select auth.jwt() ->> 'email'), ''))) $$;

create or replace function public.cp_role() returns text
language sql stable security definer set search_path = public as $$
  select a.role from app_users a
   where a.email = public.cp_email() and a.email <> '' and a.active
     and (a.role = 'super_admin' or 'callpilots' = any(a.portals)) $$;

create or replace function public.cp_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.cp_role() in ('admin','super_admin'), false) $$;

create or replace function public.cp_member_id() returns bigint
language sql stable security definer set search_path = public as $$
  select tm.id from team_members tm
   where public.cp_role() is not null and lower(btrim(tm.email)) = public.cp_email()
   order by tm.id limit 1 $$;

-- Raises unless the caller has Call Pilots access (and is an admin when p_admin)
create or replace function public.cp_require(p_admin boolean default false) returns text
language plpgsql stable security definer set search_path = public as $$
declare r text := public.cp_role();
begin
  if r is null then raise exception 'Not allowed: no Call Pilots access' using errcode = '42501'; end if;
  if p_admin and r not in ('admin','super_admin') then raise exception 'Admins only' using errcode = '42501'; end if;
  return r;
end $$;

-- Members whose data the caller may read: handler -> only self; admin -> the chosen
-- member, or the chosen team, or every Call Pilots member.
create or replace function public.cp_scope(p_member bigint default null, p_team text default null)
returns setof bigint language plpgsql stable security definer set search_path = public as $$
begin
  if not public.cp_is_admin() then
    perform public.cp_require();
    return query select public.cp_member_id() where public.cp_member_id() is not null;
  elsif p_member is not null then
    return query select p_member;
  else
    return query select tm.id from team_members tm
      where tm.is_call_pilot and (p_team is null or tm.call_pilot_team = p_team);
  end if;
end $$;

-- Status as people should read it (Paid / Pending approval / Waiting for closer list / ...)
create or replace function public.cp_incentive_status(p_status text, p_approval text, p_closer text) returns text
language sql immutable as $$
  select case
    when p_approval = 'Rejected' then 'Rejected'
    when p_status = 'Paid' then 'Paid'
    when p_approval = 'Pending Approval' then 'Pending approval'
    when p_closer is not null then p_closer
    else 'Pending' end $$;

-- Incentive type as Call Pilots calls it
create or replace function public.cp_incentive_kind(p_type text) returns text
language sql immutable as $$
  select case
    when p_type like 'Round progression%' then 'Promotion'
    when p_type = 'Final + Placed (Tool Drive)' then 'Selection'
    when p_type like 'Final + Placed (Candidate POC)%' then 'Candidate POC'
    else coalesce(p_type, '') end $$;


-- ---------------------------------------------------------------------
-- 6. Seed Call Pilots members from the old Dhruva user list (if still present)
--    Matched by email. People not found in team_members are listed in the
--    notice; add them on TTOP's Team page and set the flag with cp_set_member().
-- ---------------------------------------------------------------------
do $seed$
declare n int := 0; missing text;
begin
  if to_regclass('public.pune_private_backend__v2_user_access') is null then
    raise notice 'Call Pilots: old user list not found; set members with cp_set_member()';
    return;
  end if;
  execute $q$
    with ua as (
      select lower(btrim(u.email)) as email, upper(btrim(u.role)) as role, btrim(u.primary_team_id) as team_id
        from public.pune_private_backend__v2_user_access u
       where lower(btrim(coalesce(u.active, ''))) in ('true','yes','y','1')
         and coalesce(btrim(u.email), '') like '%@%'
         and (upper(btrim(u.role)) in ('HANDLER','SUPPORT') or coalesce(btrim(u.handler_id), '') <> '')),
    tm_ as (
      select t.team_id, btrim(t.team_name) as team_name from public.pune_private_backend__v2_team_master t)
    update public.team_members m
       set is_call_pilot = true,
           call_pilot_team = coalesce(m.call_pilot_team,
             case ua.team_id when 'TEAM-PA' then 'Pradeep Anna' when 'TEAM-HYD' then 'HYD'
                             else nullif((select tm_.team_name from tm_ where tm_.team_id = ua.team_id limit 1), '') end)
      from ua where lower(btrim(m.email)) = ua.email and not m.is_call_pilot $q$;
  get diagnostics n = row_count;
  execute $q$
    select string_agg(distinct lower(btrim(u.email)), ', ')
      from public.pune_private_backend__v2_user_access u
     where lower(btrim(coalesce(u.active, ''))) in ('true','yes','y','1')
       and (upper(btrim(u.role)) in ('HANDLER','SUPPORT') or coalesce(btrim(u.handler_id), '') <> '')
       and not exists (select 1 from public.team_members m where lower(btrim(m.email)) = lower(btrim(u.email))) $q$
    into missing;
  raise notice 'Call Pilots: % team members flagged from the old user list. Not in team_members: %', n, coalesce(missing, 'none');
end $seed$;


-- =====================================================================
-- 7. READ functions (the page calls only these)
-- =====================================================================

-- Who am I, which months to offer
create or replace function public.cp_me() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r text := public.cp_require(); a app_users%rowtype; m team_members%rowtype; today date := public.cp_list_today();
  months jsonb;
begin
  select * into a from app_users where email = public.cp_email();
  select * into m from team_members where id = public.cp_member_id();
  -- current month first, then the previous 11, then older months that have data
  select jsonb_agg(to_char(x, 'YYYY-MM') order by x desc) into months from (
    select generate_series(date_trunc('month', today) - interval '11 months', date_trunc('month', today), interval '1 month')::date as x
    union
    select distinct date_trunc('month', i.interview_date)::date from interviews i
     where i.interview_date is not null and i.interview_date < date_trunc('month', today) - interval '11 months'
       and (i.tool_drive_member_id in (select public.cp_scope()) or i.call_support_1 in (select public.cp_scope())
            or i.call_support_2 in (select public.cp_scope()))) s;
  return jsonb_build_object(
    'email', a.email, 'name', coalesce(m.name, a.name, a.email), 'role', r, 'isAdmin', r in ('admin','super_admin'),
    'memberId', m.id, 'team', m.call_pilot_team, 'today', today, 'months', coalesce(months, '[]'::jsonb),
    'teams', case when r in ('admin','super_admin') then (select coalesce(jsonb_agg(distinct t.call_pilot_team), '[]'::jsonb)
                                                          from team_members t where t.is_call_pilot and t.call_pilot_team is not null)
                  else '[]'::jsonb end);
end $$;

-- Dashboard (screenshots 01 + 02). p_month = any day in the month.
create or replace function public.cp_dashboard(p_month date default null, p_member bigint default null, p_team text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  today date := public.cp_list_today();
  m0 date := date_trunc('month', coalesce(p_month, today))::date;
  m1 date := (date_trunc('month', coalesce(p_month, today)) + interval '1 month')::date;
  p0 date := (date_trunc('month', coalesce(p_month, today)) - interval '1 month')::date;
  ids bigint[];
  out jsonb;
begin
  perform public.cp_require();
  ids := array(select public.cp_scope(p_member, p_team));

  with c as (
    select i.* from interviews i
     where i.interview_date >= m0 and i.interview_date < m1 and i.tool_drive_member_id = any(ids)),
  s as (
    select i.* from interviews i
     where i.interview_date >= m0 and i.interview_date < m1
       and (i.call_support_1 = any(ids) or i.call_support_2 = any(ids))),
  inc as (
    select x.*, public.cp_incentive_kind(x.incentive_type) as kind,
           public.cp_incentive_status(x.status, x.approval_status, x.closer_check) as st
      from incentives x
     where x.recipient_member_id = any(ids) and x.event_date >= (m0 - interval '11 months')::date and x.event_date < m1)
  select jsonb_build_object(
    'month', to_char(m0, 'YYYY-MM'),
    'today', jsonb_build_object(
      'assigned',  (select count(*) from interviews i where i.interview_date = today and i.tool_drive_member_id = any(ids) and i.interview_status <> 'Rescheduled'),
      'completed', (select count(*) from interviews i where i.interview_date = today and i.tool_drive_member_id = any(ids) and i.interview_status = 'Completed')),
    'calls', jsonb_build_object(
      'assigned',    (select count(*) from c where c.interview_status <> 'Rescheduled'),
      'completed',   (select count(*) from c where c.interview_status = 'Completed'),
      'pending',     (select count(*) from c where c.interview_status in ('Scheduled','Date Pending')),
      'rescheduled', (select count(*) from c where c.interview_status = 'Rescheduled'),
      'cancelled',   (select count(*) from c where c.interview_status = 'Cancelled'),
      'support',     (select count(*) from s where s.interview_status <> 'Rescheduled'),
      'rescheduleRequests', (select count(*) from c where c.cp_reschedule_requested_at is not null and c.interview_status in ('Scheduled','Date Pending'))),
    'incentives', jsonb_build_object(
      'total',      (select coalesce(sum(amount), 0) from inc where event_date >= m0 and st <> 'Rejected'),
      'promotion',  (select coalesce(sum(amount), 0) from inc where event_date >= m0 and st <> 'Rejected' and kind = 'Promotion'),
      'selection',  (select coalesce(sum(amount), 0) from inc where event_date >= m0 and st <> 'Rejected' and kind = 'Selection'),
      'candidatePoc', (select coalesce(sum(amount), 0) from inc where event_date >= m0 and st <> 'Rejected' and kind = 'Candidate POC'),
      'promotions', (select count(*) from inc where event_date >= m0 and st <> 'Rejected' and kind = 'Promotion'),
      'records',    (select count(*) from inc where event_date >= m0),
      'paid',       (select coalesce(sum(amount), 0) from inc where event_date >= m0 and st = 'Paid'),
      'waiting',    (select coalesce(sum(amount), 0) from inc where event_date >= m0 and st not in ('Paid','Rejected')),
      'prevTotal',  (select coalesce(sum(amount), 0) from inc where event_date >= p0 and event_date < m0 and st <> 'Rejected')),
    'trend', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(g, 'YYYY-MM'),
                'promotion', (select coalesce(sum(amount), 0) from inc where date_trunc('month', event_date) = g and st <> 'Rejected' and kind = 'Promotion'),
                'selection', (select coalesce(sum(amount), 0) from inc where date_trunc('month', event_date) = g and st <> 'Rejected' and kind = 'Selection'),
                'total',     (select coalesce(sum(amount), 0) from inc where date_trunc('month', event_date) = g and st <> 'Rejected'))
               order by g), '[]'::jsonb)
              from generate_series(m0 - interval '11 months', m0::timestamp, interval '1 month') g),
    'recent', (select coalesce(jsonb_agg(r order by r->>'date' desc, r->>'id' desc), '[]'::jsonb) from (
                select jsonb_build_object('id', inc.id, 'date', inc.event_date, 'kind', inc.kind, 'status', inc.st,
                         'amount', inc.amount, 'round', inc.round_label, 'candidate', cd.name, 'client', cl.name,
                         'handler', tm.name) r
                  from inc join candidates cd on cd.id = inc.candidate_id join clients cl on cl.id = inc.client_id
                  left join team_members tm on tm.id = inc.recipient_member_id
                 where inc.event_date >= m0 order by inc.event_date desc, inc.id desc limit 10) z),
    'byHandler', case when public.cp_is_admin() then (
                select coalesce(jsonb_agg(h order by (h->>'amount')::numeric desc, h->>'handler'), '[]'::jsonb) from (
                  select jsonb_build_object('memberId', tm.id, 'handler', tm.name, 'team', tm.call_pilot_team,
                           'assigned', (select count(*) from c where c.tool_drive_member_id = tm.id and c.interview_status <> 'Rescheduled'),
                           'completed', (select count(*) from c where c.tool_drive_member_id = tm.id and c.interview_status = 'Completed'),
                           'amount', (select coalesce(sum(amount), 0) from inc where inc.recipient_member_id = tm.id and inc.event_date >= m0 and inc.st <> 'Rejected')) h
                    from team_members tm where tm.id = any(ids)) y)
                 else null end)
  into out;
  return out;
end $$;

-- Incentives page (screenshot 03)
create or replace function public.cp_incentives(p_month date default null, p_member bigint default null, p_team text default null,
  p_kind text default null, p_status text default null, p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  today date := public.cp_list_today();
  m0 date := date_trunc('month', coalesce(p_month, today))::date;
  m1 date := (date_trunc('month', coalesce(p_month, today)) + interval '1 month')::date;
  ids bigint[];
  q text := '%' || lower(btrim(coalesce(p_search, ''))) || '%';
begin
  perform public.cp_require();
  ids := array(select public.cp_scope(p_member, p_team));
  return (select coalesce(jsonb_agg(r order by r->>'date' desc, (r->>'id')::bigint desc), '[]'::jsonb) from (
    select jsonb_build_object('id', x.id, 'date', x.event_date, 'kind', public.cp_incentive_kind(x.incentive_type),
             'type', x.incentive_type, 'round', x.round_label, 'amount', x.amount,
             'status', public.cp_incentive_status(x.status, x.approval_status, x.closer_check),
             'candidate', cd.name, 'client', cl.name, 'handler', coalesce(tm.name, x.recipient_name),
             'team', tm.call_pilot_team) r
      from incentives x
      join candidates cd on cd.id = x.candidate_id
      join clients cl on cl.id = x.client_id
      left join team_members tm on tm.id = x.recipient_member_id
     where x.recipient_member_id = any(ids) and x.event_date >= m0 and x.event_date < m1
       and (p_kind is null or public.cp_incentive_kind(x.incentive_type) = p_kind)
       and (p_status is null or public.cp_incentive_status(x.status, x.approval_status, x.closer_check) = p_status)
       and (btrim(coalesce(p_search, '')) = '' or lower(cd.name) like q or lower(cl.name) like q
            or lower(coalesce(tm.name, x.recipient_name, '')) like q)) z);
end $$;

-- My calls (Today / Tomorrow / This week / Not updated). Admin may pass p_member.
create or replace function public.cp_my_calls(p_member bigint default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  today date := public.cp_list_today();
  me bigint;
begin
  perform public.cp_require();
  me := case when public.cp_is_admin() then coalesce(p_member, public.cp_member_id()) else public.cp_member_id() end;
  if me is null then
    return jsonb_build_object('today', today, 'memberId', null, 'calls', '[]'::jsonb);
  end if;
  return jsonb_build_object('today', today, 'memberId', me, 'calls', (
    select coalesce(jsonb_agg(r order by r->>'date', r->>'sort'), '[]'::jsonb) from (
      select jsonb_build_object(
        'id', i.id, 'date', i.interview_date, 'time', to_char(i.interview_time, 'HH24:MI'), 'sort', i.sort_key,
        'candidate', cd.name, 'client', cl.name, 'role', i.role, 'round', i.round, 'type', i.interview_type,
        'duration', i.duration_minutes, 'status', i.interview_status, 'notes', i.notes, 'feedback', i.feedback,
        'myPart', case when i.tool_drive_member_id = me then 'Tool Drive' else 'Call Support' end,
        'toolDrive', i.tool_drive,
        'support', nullif(concat_ws(', ', s1.name, s2.name), ''),
        'rescheduleRequested', i.cp_reschedule_requested_at is not null, 'rescheduleNote', i.cp_reschedule_note,
        'group', case
          when i.interview_date = today then 'today'
          when i.interview_date = today + 1 then 'tomorrow'
          when i.interview_date > today + 1 and i.interview_date <= today + 6 then 'week'
          when i.interview_date < today and i.interview_status = 'Scheduled' then 'notUpdated'
          else 'other' end) r
        from interviews i
        join candidates cd on cd.id = i.candidate_id
        join clients cl on cl.id = i.client_id
        left join team_members s1 on s1.id = i.call_support_1
        left join team_members s2 on s2.id = i.call_support_2
       where (i.tool_drive_member_id = me or i.call_support_1 = me or i.call_support_2 = me)
         and i.interview_date between today - 30 and today + 6
         and (i.interview_date >= today or i.interview_status = 'Scheduled')) z));
end $$;

-- Admin: Call Pilots members (for filters and assignment)
create or replace function public.cp_members() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cp_require(true);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', tm.id, 'name', tm.name, 'email', tm.email,
            'isCallPilot', tm.is_call_pilot, 'team', tm.call_pilot_team, 'isToolDrive', tm.is_tool_drive,
            'isCallSupport', tm.is_call_support) order by tm.is_call_pilot desc, tm.name), '[]'::jsonb)
            from team_members tm);
end $$;

-- Admin: interviews on one list day (Assign Interviews matches the pasted list to these)
create or replace function public.cp_day_calls(p_date date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cp_require(true);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'time', to_char(i.interview_time, 'HH24:MI'),
            'candidate', cd.name, 'client', cl.name, 'role', i.role, 'round', i.round, 'status', i.interview_status,
            'toolDrive', i.tool_drive, 'toolDriveMemberId', i.tool_drive_member_id, 'duration', i.duration_minutes,
            'rescheduleRequested', i.cp_reschedule_requested_at is not null) order by i.sort_key), '[]'::jsonb)
            from interviews i join candidates cd on cd.id = i.candidate_id join clients cl on cl.id = i.client_id
           where i.interview_date = p_date and i.interview_status <> 'Rescheduled');
end $$;

-- Admin: Tool Drive texts that could not be matched to one person (ambiguous / unknown)
create or replace function public.cp_unmatched_tool_drive(p_days int default 60)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.cp_require(true);
  return (select coalesce(jsonb_agg(jsonb_build_object('toolDrive', t, 'calls', n) order by n desc), '[]'::jsonb) from (
    select btrim(i.tool_drive) t, count(*) n from interviews i
     where i.tool_drive_member_id is null and coalesce(btrim(i.tool_drive), '') <> ''
       and i.interview_date >= public.cp_list_today() - p_days
     group by 1) z);
end $$;


-- =====================================================================
-- 8. WRITE functions
-- =====================================================================

-- Admin: mark a team member as a Call Pilots handler (and their team)
create or replace function public.cp_set_member(p_member bigint, p_is_call_pilot boolean, p_team text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.cp_require(true);
  update team_members set is_call_pilot = coalesce(p_is_call_pilot, false), call_pilot_team = public.cp_clean(p_team)
   where id = p_member;
  if not found then raise exception 'Team member not found'; end if;
  insert into activity_log (actor_email, action, entity, entity_id)
  values (public.cp_email(), 'Call Pilots: ' || case when p_is_call_pilot then 'added handler' else 'removed handler' end
          || coalesce(' (' || public.cp_clean(p_team) || ')', ''), 'team_member', p_member::text);
  return jsonb_build_object('ok', true);
end $$;

-- Handler (own call as Tool Drive) or admin: complete / cancel / request reschedule / feedback.
-- Call Support may add feedback only.
create or replace function public.cp_update_call(p_id bigint, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  i interviews%rowtype; me bigint := public.cp_member_id(); adm boolean := public.cp_is_admin();
  who text; note text := public.cp_clean(p_note); stamp text;
begin
  perform public.cp_require();
  select * into i from interviews where id = p_id for update;
  if not found then raise exception 'Call not found'; end if;
  if not adm and (me is null or (i.tool_drive_member_id is distinct from me
      and not (p_action = 'feedback' and me in (i.call_support_1, i.call_support_2)))) then
    raise exception 'Not your call' using errcode = '42501';
  end if;
  who := coalesce((select name from team_members where id = me), public.cp_email());
  stamp := to_char(now() at time zone 'Asia/Kolkata', 'DD Mon HH24:MI');

  if p_action = 'complete' then
    if i.interview_status not in ('Scheduled') then raise exception 'Only a scheduled call can be completed'; end if;
    if i.interview_date > public.cp_list_today() then raise exception 'This call is in the future'; end if;
    update interviews set interview_status = 'Completed', cp_reschedule_requested_at = null, cp_reschedule_note = null,
           feedback = case when note is null then feedback else concat_ws(E'\n', feedback, '[' || stamp || ' ' || who || '] ' || note) end
     where id = p_id;
  elsif p_action = 'cancel' then
    if i.interview_status not in ('Scheduled','Date Pending') then raise exception 'Only a scheduled call can be cancelled'; end if;
    update interviews set interview_status = 'Cancelled', cp_reschedule_requested_at = null, cp_reschedule_note = null,
           feedback = case when note is null then feedback else concat_ws(E'\n', feedback, '[' || stamp || ' ' || who || '] Cancelled: ' || note) end
     where id = p_id;
  elsif p_action = 'request_reschedule' then
    if i.interview_status not in ('Scheduled','Date Pending') then raise exception 'Only a scheduled call can be rescheduled'; end if;
    update interviews set cp_reschedule_requested_at = now(), cp_reschedule_note = note where id = p_id;
  elsif p_action = 'clear_reschedule' then
    if not adm then raise exception 'Admins only' using errcode = '42501'; end if;
    update interviews set cp_reschedule_requested_at = null, cp_reschedule_note = null where id = p_id;
  elsif p_action = 'feedback' then
    if note is null then raise exception 'Write the feedback first'; end if;
    update interviews set feedback = concat_ws(E'\n', feedback, '[' || stamp || ' ' || who || '] ' || note) where id = p_id;
  else
    raise exception 'Unknown action %', p_action;
  end if;

  insert into activity_log (actor_email, action, entity, entity_id)
  values (public.cp_email(), 'Call Pilots: ' || replace(p_action, '_', ' ') || coalesce(' - ' || left(note, 200), ''), 'interview', p_id::text);
  return jsonb_build_object('ok', true, 'id', p_id, 'action', p_action);
end $$;


-- Admin: import parsed Doc / WhatsApp lines (page 4).
-- p_rows: [{cand, client, role, date:'YYYY-MM-DD', time:'HH:MM'|'' , dur:60, round, type, poc, notes, tech, mode:'new'|'reschedule'}]
-- Same rules as TTOP (verify first): a new candidate, client or role, and a same-round
-- duplicate wait on TTOP's Import Review; an identical interview is skipped. Running the
-- same paste twice creates nothing new. p_dry = preview only (nothing is written).
create or replace function public.cp_import_interviews(p_rows jsonb, p_dry boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; out jsonb := '[]'::jsonb; res text; msg text; who text;
  v_cand text; v_client text; v_role text; v_round text; v_type text; v_date date; v_time time; v_dur int; v_poc text;
  v_notes text; v_tech boolean; v_mode text;
  c_id bigint; cl_id bigint; cl_name text; ex interviews%rowtype; new_id bigint; kind text; has_prev boolean;
  today date := public.cp_list_today();
  n_add int := 0; n_held int := 0; n_skip int := 0; n_rs int := 0; n_fail int := 0;
  types text[] := array['Recruiter','Technical','Hiring Manager','Leadership','Director','Coding',
                        'System Design','Assessment','Presentation','Cultural Fit','Onsite'];
begin
  perform public.cp_require(true);
  who := coalesce((select name from team_members where id = public.cp_member_id()), public.cp_email());
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'p_rows must be a JSON array'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    res := null; msg := null; new_id := null; kind := null; c_id := null; cl_id := null; cl_name := null;
    begin
      v_cand   := public.cp_clean(r->>'cand');
      v_client := public.cp_clean(r->>'client');
      v_role   := public.cp_clean(r->>'role');
      v_round  := coalesce(public.cp_clean(r->>'round'), 'Round 1');
      v_type   := case when public.cp_clean(r->>'type') = any(types) then public.cp_clean(r->>'type') else 'Technical' end;
      v_date   := nullif(r->>'date', '')::date;
      v_time   := nullif(r->>'time', '')::time;
      v_dur    := coalesce(nullif(regexp_replace(coalesce(r->>'dur', ''), '\D', '', 'g'), '')::int, 60);
      v_poc    := public.cp_clean(r->>'poc');
      v_notes  := public.cp_clean(r->>'notes');
      v_tech   := lower(coalesce(r->>'tech', '')) in ('true', '1', 'yes');
      v_mode   := coalesce(r->>'mode', 'new');

      if v_cand is null or v_client is null or v_date is null then
        res := 'skipped'; msg := (case when v_client is null then 'client' when v_cand is null then 'candidate' else 'date' end) || ' is missing';
      else
        select id into c_id from candidates where public.name_key(name) = public.name_key(v_cand) order by id limit 1;
        select id, name into cl_id, cl_name from clients
         where lower(name) = lower(v_client) or (public.client_key(name) <> '' and public.client_key(name) = public.client_key(v_client))
         order by (lower(name) = lower(v_client)) desc, id limit 1;

        if c_id is null then kind := 'newc';
        elsif cl_id is null then kind := 'newcl';
        elsif public.cp_role_key(v_role) <> ''
              and not exists (select 1 from interviews x where public.cp_role_key(x.role) = public.cp_role_key(v_role)) then kind := 'newrole';
        end if;

        if kind is null then
          -- identical interview already there (any status): skip
          select * into ex from interviews x
           where x.candidate_id = c_id and x.client_id = cl_id and x.round = v_round
             and ((v_time is null and x.interview_date is null and x.interview_status = 'Date Pending')
                  or (x.interview_date = v_date and x.interview_time = v_time))
           limit 1;
          if found then
            res := 'exists'; new_id := ex.id;
          else
            -- same candidate + client + round still active
            select * into ex from interviews x
             where x.candidate_id = c_id and x.client_id = cl_id and x.round = v_round and v_round <> 'Loop'
               and x.interview_status in ('Scheduled','Date Pending','Completed')
               and (public.cp_role_key(x.role) = '' or public.cp_role_key(v_role) = '' or public.cp_role_key(x.role) = public.cp_role_key(v_role))
             order by x.sort_key desc nulls last limit 1;
            has_prev := found;
            if has_prev and not (v_mode = 'reschedule' or coalesce(v_notes, '') ~* 'resched') then
              kind := 'dupe';
            else
              if not p_dry then
                insert into interviews (candidate_id, client_id, role, interview_date, interview_time, duration_minutes, round,
                                        interview_type, source, prep_status, interview_status, notes, rescheduled_from, sheet_date,
                                        is_technical, marked_technical_by)
                values (c_id, cl_id, v_role, case when v_time is null then null else v_date end, v_time, v_dur, v_round,
                        v_type, 'Direct', 'Pending',
                        case when v_time is null then 'Date Pending' when v_date < today then 'Completed' else 'Scheduled' end,
                        public.cp_clean(concat_ws(' · ', v_notes, case when v_time is null then 'Time not in list (' || v_date || ')' end)),
                        case when has_prev then ex.id end, today,
                        v_tech and v_round = 'Round 1', case when v_tech and v_round = 'Round 1' then 'Call Pilots import' end)
                returning id into new_id;
                if has_prev then
                  update interviews set interview_status = 'Rescheduled' where id = ex.id;
                end if;
              end if;
              res := case when has_prev then 'rescheduled' else 'added' end;
            end if;
          end if;
        end if;

        if kind is not null then
          -- wait on TTOP's Import Review (never twice for the same line)
          if exists (select 1 from import_review q
                      where q.payload->>'kind' = kind and public.name_key(q.payload->>'cand') = public.name_key(v_cand)
                        and public.client_key(q.payload->>'client') = public.client_key(coalesce(cl_name, v_client))
                        and q.payload->>'round' = v_round and q.payload->>'date' = v_date::text
                        and coalesce(q.payload->>'time', '') = coalesce(to_char(v_time, 'HH24:MI'), '')) then
            res := 'already_in_review';
          else
            if not p_dry then
              insert into import_review (reason, created_by, payload)
              values (case kind when 'dupe' then 'dupe' when 'newc' then 'cand' else 'fix' end, who,
                      jsonb_build_object('cand', v_cand, 'role', coalesce(v_role, ''), 'client', coalesce(cl_name, v_client),
                        'date', v_date, 'time', coalesce(to_char(v_time, 'HH24:MI'), ''), 'dur', v_dur || ' Minutes',
                        'round', v_round, 'type', v_type, 'td', '', 'poc', coalesce(v_poc, ''), 'prep', 'Pending',
                        'notes', coalesce(v_notes, ''), 'loc', '', 'rsId', '', 'kind', kind, 'iid', '',
                        'xid', case when kind = 'dupe' then ex.id::text else '' end, 'msg', '', 'hold', '1',
                        'tech', case when v_tech then '1' else '' end));
            end if;
            res := 'review_' || case kind when 'newc' then 'new_candidate' when 'newcl' then 'new_client'
                                          when 'newrole' then 'new_role' else 'duplicate' end;
          end if;
        end if;
      end if;
    exception when others then
      res := 'failed'; msg := sqlerrm;
    end;

    if res in ('added') then n_add := n_add + 1;
    elsif res = 'rescheduled' then n_rs := n_rs + 1;
    elsif res like 'review_%' then n_held := n_held + 1;
    elsif res = 'failed' then n_fail := n_fail + 1;
    else n_skip := n_skip + 1; end if;
    out := out || jsonb_build_array(jsonb_build_object('result', res, 'message', msg, 'interviewId', new_id,
                                    'cand', v_cand, 'client', v_client, 'round', v_round, 'date', v_date));
  end loop;

  if not p_dry and (n_add + n_rs + n_held + n_fail) > 0 then
    insert into activity_log (actor_email, action, entity)
    values (public.cp_email(), format('Call Pilots import: %s added, %s rescheduled, %s to Import Review, %s skipped, %s failed',
                                      n_add, n_rs, n_held, n_skip, n_fail), 'interviews');
  end if;
  return jsonb_build_object('dry', p_dry, 'added', n_add, 'rescheduled', n_rs, 'review', n_held, 'skipped', n_skip,
                            'failed', n_fail, 'rows', out);
end $$;


-- Admin: apply the day's Tool Drive list (page 5).
-- p_rows: [{interviewId, memberId | name, fromTeam:boolean}]
--   fromTeam = the person came from a team heading (*HYD Team*): only fills an empty
--   assignment, never replaces one. Sets tool_drive (text) AND tool_drive_member_id, so
--   TTOP's incentive triggers fire exactly as when TTOP changes the Tool Drive.
create or replace function public.cp_assign_tool_drive(p_date date, p_rows jsonb, p_dry boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; out jsonb := '[]'::jsonb; res text; i interviews%rowtype; mid bigint; mname text; clash bigint;
  n_set int := 0; n_same int := 0; n_kept int := 0; n_bad int := 0;
begin
  perform public.cp_require(true);
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'p_rows must be a JSON array'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    res := null; mid := null; mname := null; clash := null;
    select * into i from interviews where id = nullif(r->>'interviewId', '')::bigint for update;
    if not found then res := 'not_found';
    elsif i.interview_date is distinct from p_date then res := 'other_day';
    else
      mid := coalesce(nullif(r->>'memberId', '')::bigint, public.cp_match_member(r->>'name'));
      select name into mname from team_members where id = mid;
      if mname is null then res := 'unknown_person';
      elsif i.tool_drive_member_id = mid then res := 'unchanged';
      elsif coalesce((r->>'fromTeam')::boolean, false)
            and (i.tool_drive_member_id is not null or coalesce(btrim(i.tool_drive), '') <> '') then res := 'kept_existing';
      else
        select x.id into clash from interviews x
         where x.id <> i.id and x.tool_drive_member_id = mid and x.interview_date = p_date
           and x.interview_time = i.interview_time and x.interview_status in ('Scheduled','Completed') limit 1;
        if not p_dry then
          update interviews set tool_drive = mname, tool_drive_member_id = mid where id = i.id;
        end if;
        res := case when i.tool_drive_member_id is null and coalesce(btrim(i.tool_drive), '') = '' then 'assigned' else 'changed' end;
      end if;
    end if;
    if res in ('assigned','changed') then n_set := n_set + 1;
    elsif res = 'unchanged' then n_same := n_same + 1;
    elsif res = 'kept_existing' then n_kept := n_kept + 1;
    else n_bad := n_bad + 1; end if;
    out := out || jsonb_build_array(jsonb_build_object('interviewId', i.id, 'result', res, 'memberId', mid,
                                    'name', mname, 'previous', i.tool_drive, 'clashWith', clash));
  end loop;
  if not p_dry and n_set > 0 then
    insert into activity_log (actor_email, action, entity)
    values (public.cp_email(), format('Call Pilots Tool Drive list %s: %s assigned/changed, %s unchanged, %s kept, %s not applied',
                                      p_date, n_set, n_same, n_kept, n_bad), 'interviews');
  end if;
  return jsonb_build_object('dry', p_dry, 'set', n_set, 'unchanged', n_same, 'kept', n_kept, 'notApplied', n_bad, 'rows', out);
end $$;


-- =====================================================================
-- 8b. Super admin home (server only, called with the service key)
-- =====================================================================
create or replace function public.app_dashboard_callpilots(p_today date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  today date := coalesce(p_today, public.cp_list_today());
  m0 date := date_trunc('month', today)::date;
begin
  return jsonb_build_object(
    'today', today,
    'teams', (select coalesce(jsonb_agg(t order by t->>'team'), '[]'::jsonb) from (
      select jsonb_build_object(
        'team', coalesce(g.team, 'No team'),
        'handlers', (select count(*) from team_members m where m.is_call_pilot and m.call_pilot_team is not distinct from g.team),
        'calls', jsonb_build_object(
          'total', (select count(*) from interviews i join team_members m on m.id = i.tool_drive_member_id
                     where m.is_call_pilot and m.call_pilot_team is not distinct from g.team and i.interview_date = today and i.interview_status <> 'Rescheduled'),
          'byStatus', (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from (
                         select i.interview_status s, count(*) n from interviews i join team_members m on m.id = i.tool_drive_member_id
                          where m.is_call_pilot and m.call_pilot_team is not distinct from g.team and i.interview_date = today
                          group by 1) z),
          'today', (select coalesce(jsonb_agg(jsonb_build_object('time', to_char(i.interview_time, 'HH24:MI'), 'candidate', cd.name,
                                       'client', cl.name, 'round', i.round, 'handler', m.name, 'status', i.interview_status) order by i.sort_key), '[]'::jsonb)
                     from interviews i join team_members m on m.id = i.tool_drive_member_id
                     join candidates cd on cd.id = i.candidate_id join clients cl on cl.id = i.client_id
                    where m.is_call_pilot and m.call_pilot_team is not distinct from g.team and i.interview_date = today
                      and i.interview_status <> 'Rescheduled'),
          'rescheduleRequests', (select count(*) from interviews i join team_members m on m.id = i.tool_drive_member_id
                     where m.is_call_pilot and m.call_pilot_team is not distinct from g.team
                       and i.cp_reschedule_requested_at is not null and i.interview_status in ('Scheduled','Date Pending')),
          'notUpdated', (select count(*) from interviews i join team_members m on m.id = i.tool_drive_member_id
                     where m.is_call_pilot and m.call_pilot_team is not distinct from g.team
                       and i.interview_date < today and i.interview_date >= today - 30 and i.interview_status = 'Scheduled')),
        'incentives', jsonb_build_object(
          'monthAmount', (select coalesce(sum(x.amount), 0) from incentives x join team_members m on m.id = x.recipient_member_id
                     where m.is_call_pilot and m.call_pilot_team is not distinct from g.team and x.event_date >= m0
                       and x.approval_status <> 'Rejected'),
          'monthCount', (select count(*) from incentives x join team_members m on m.id = x.recipient_member_id
                     where m.is_call_pilot and m.call_pilot_team is not distinct from g.team and x.event_date >= m0),
          'byHandler', (select coalesce(jsonb_agg(h order by (h->>'amount')::numeric desc), '[]'::jsonb) from (
                     select jsonb_build_object('handler', m.name,
                              'amount', coalesce(sum(x.amount) filter (where x.approval_status <> 'Rejected'), 0),
                              'promotions', count(*) filter (where x.incentive_type like 'Round progression%'),
                              'selections', count(*) filter (where x.incentive_type = 'Final + Placed (Tool Drive)')) h
                       from team_members m join incentives x on x.recipient_member_id = m.id and x.event_date >= m0
                      where m.is_call_pilot and m.call_pilot_team is not distinct from g.team
                      group by m.id, m.name) y))) t
      from (select distinct call_pilot_team as team from team_members where is_call_pilot) g) z),
    'unmatchedToolDrive', (select count(distinct btrim(i.tool_drive)) from interviews i
                     where i.tool_drive_member_id is null and coalesce(btrim(i.tool_drive), '') <> '' and i.interview_date >= today - 60),
    'activity', (select coalesce(jsonb_agg(jsonb_build_object('at', a.at, 'who', coalesce(a.actor_name, a.actor_email), 'action', a.action) order by a.at desc), '[]'::jsonb)
                   from (select * from activity_log where action like 'Call Pilots%' order by at desc limit 12) a));
end $$;
revoke all on function public.app_dashboard_callpilots(date) from public, anon, authenticated;
grant execute on function public.app_dashboard_callpilots(date) to service_role;


-- =====================================================================
-- 9. Grants: the page (signed-in users) may call only the cp_* entry points;
--    every one of them checks cp_role() itself. Nothing for anon.
-- =====================================================================
do $g$
declare f text;
begin
  foreach f in array array[
    'cp_me()', 'cp_dashboard(date,bigint,text)', 'cp_incentives(date,bigint,text,text,text,text)',
    'cp_my_calls(bigint)', 'cp_members()', 'cp_day_calls(date)', 'cp_unmatched_tool_drive(int)',
    'cp_set_member(bigint,boolean,text)', 'cp_update_call(bigint,text,text)',
    'cp_import_interviews(jsonb,boolean)', 'cp_assign_tool_drive(date,jsonb,boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array[
    'cp_role()', 'cp_is_admin()', 'cp_member_id()', 'cp_require(boolean)', 'cp_scope(bigint,text)',
    'cp_email()', 'trg_interviews_td_member()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
  end loop;
  -- helpers the entry points use; harmless to call directly (they only answer about the caller)
  grant execute on function public.cp_role(), public.cp_is_admin(), public.cp_member_id(),
                            public.cp_require(boolean), public.cp_scope(bigint,text), public.cp_email() to authenticated;
end $g$;


-- =====================================================================
-- 10. Server key time limit: 60 s, the same as the app's Vercel function.
--     (Replaces the 240 s that the old Dhruva CSV import needed.)
-- =====================================================================
alter role service_role set statement_timeout = '60s';
notify pgrst, 'reload config';


-- =====================================================================
-- Checks (read the results)
-- =====================================================================
select 'portals' as check, portals::text as value, count(*) as n from public.app_users group by 2
union all
select 'call pilots members', coalesce(call_pilot_team, '(no team)'), count(*) from public.team_members where is_call_pilot group by 2
union all
select 'interviews with Tool Drive text', case when tool_drive_member_id is null then 'NOT matched (see cp_unmatched_tool_drive)' else 'matched' end, count(*)
  from public.interviews where coalesce(btrim(tool_drive), '') <> '' group by 2
order by 1, 2;
