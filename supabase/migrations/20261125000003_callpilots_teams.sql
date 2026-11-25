-- =====================================================================
-- Call Pilots teams in People (decision 2026-11-25)
--
-- People (home page) now gives access per team:
--   TTOP | Call Pilots – Pradeep Anna Team | Call Pilots – HYD Team
--   * super admin: everything, all teams
--   * admin of a team: that team's handlers, calls and incentives only
--   * user of a team: their own calls and incentives (a handler of that team)
--
-- Stored as app_users.portals (ttop / callpilots, unchanged meaning) plus the new
-- app_users.cp_teams. Saving a person with a Call Pilots team also makes them a
-- handler of that team (team_members.is_call_pilot / call_pilot_team), and adds
-- them to TTOP's team list if they are not there yet (needed so calls can be
-- assigned to them and incentives reach them).
--
-- Replaces the Call Pilots functions that decide what an admin may see or change.
-- Run after 20261125000001 and 20261125000002. Safe to run again.
-- Supabase > SQL Editor > New query > paste this whole file > Run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Teams per person
-- ---------------------------------------------------------------------
alter table public.app_users add column if not exists cp_teams text[] not null default '{}';
alter table public.app_users drop constraint if exists app_users_cp_teams_check;
alter table public.app_users add constraint app_users_cp_teams_check
  check (cp_teams <@ array['Pradeep Anna','HYD']::text[]);

-- super admin: both portals, both teams. Call Pilots portal <-> at least one team.
create or replace function public.app_users_normalize() returns trigger
language plpgsql set search_path = public as $$
begin
  new.email := lower(btrim(new.email));
  if new.role = 'super_admin' then
    new.portals := array['callpilots','ttop'];
    new.cp_teams := array['HYD','Pradeep Anna'];
  else
    new.cp_teams := array(select distinct t from unnest(coalesce(new.cp_teams, '{}')) t order by t);
    if cardinality(new.cp_teams) > 0 then
      new.portals := array(select distinct p from unnest(coalesce(new.portals, '{}') || array['callpilots']) p order by p);
    elsif tg_op = 'UPDATE' then
      -- teams were all removed on People: Call Pilots access goes too
      if 'callpilots' = any(coalesce(new.portals, '{}')) and cardinality(coalesce(old.cp_teams, '{}')) > 0 then
        new.portals := array_remove(new.portals, 'callpilots');
      end if;
    end if;
    new.portals := array(select distinct p from unnest(coalesce(new.portals, '{}')) p order by p);
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Existing people: their team from TTOP's team list (handlers), by email
update public.app_users a
   set cp_teams = array[tm.call_pilot_team]
  from public.team_members tm
 where lower(btrim(tm.email)) = a.email and a.role <> 'super_admin'
   and 'callpilots' = any(a.portals) and cardinality(a.cp_teams) = 0
   and tm.call_pilot_team in ('Pradeep Anna','HYD');

-- ---------------------------------------------------------------------
-- 2. People -> handlers: a person with a Call Pilots team is a handler of that team
-- ---------------------------------------------------------------------
create or replace function public.trg_app_users_callpilots() returns trigger
language plpgsql security definer set search_path = public as $$
declare mid bigint; team text;
begin
  if tg_op = 'DELETE' then
    update team_members set is_call_pilot = false where lower(btrim(email)) = old.email;
    return old;
  end if;
  if new.role = 'super_admin' then return new; end if;          -- super admins are set as handlers by hand
  select id, call_pilot_team into mid, team from team_members where lower(btrim(email)) = new.email order by id limit 1;
  if new.active and 'callpilots' = any(new.portals) and cardinality(new.cp_teams) > 0 then
    -- keep the current team when it is still one of theirs, else the first one
    team := case when team = any(new.cp_teams) then team else new.cp_teams[1] end;
    if mid is null then
      insert into team_members (name, email, is_call_pilot, call_pilot_team)
      values (coalesce(public.cp_clean(new.name), split_part(new.email, '@', 1)), new.email, true, team);
    else
      update team_members set is_call_pilot = true, call_pilot_team = team where id = mid;
    end if;
  elsif mid is not null then
    update team_members set is_call_pilot = false where id = mid;
  end if;
  return new;
end $$;
drop trigger if exists t_app_users_callpilots on public.app_users;
create trigger t_app_users_callpilots after insert or update of role, portals, cp_teams, active, name or delete on public.app_users
  for each row execute function public.trg_app_users_callpilots();

-- apply once to everyone already in People
update public.app_users set cp_teams = cp_teams where 'callpilots' = any(portals) and role <> 'super_admin';


-- ---------------------------------------------------------------------
-- 3. Who may see which team
-- ---------------------------------------------------------------------
create or replace function public.cp_is_super() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.cp_role() = 'super_admin', false) $$;

-- The caller's teams: super admin -> every team; others -> their People teams
create or replace function public.cp_my_teams() returns text[]
language sql stable security definer set search_path = public as $$
  select case
    when public.cp_role() is null then '{}'::text[]
    when public.cp_role() = 'super_admin' then
      array(select distinct t from (select unnest(array['Pradeep Anna','HYD']) t
                                    union select call_pilot_team from team_members where call_pilot_team is not null) z order by t)
    else coalesce((select a.cp_teams from app_users a where a.email = public.cp_email()), '{}') end $$;

-- Is this team member within the caller's teams? (super admin: anyone)
create or replace function public.cp_member_in_scope(p_member bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select p_member is not null and (public.cp_is_super() or exists (
    select 1 from team_members tm where tm.id = p_member and tm.call_pilot_team = any(public.cp_my_teams()))) $$;

-- Members whose data the caller may read:
--   user  -> only self
--   admin -> the chosen member / team, always within their own teams
--   super -> anyone
create or replace function public.cp_scope(p_member bigint default null, p_team text default null)
returns setof bigint language plpgsql stable security definer set search_path = public as $$
declare teams text[] := public.cp_my_teams();
begin
  if not public.cp_is_admin() then
    perform public.cp_require();
    return query select public.cp_member_id() where public.cp_member_id() is not null;
  elsif p_member is not null then
    return query select p_member where public.cp_member_in_scope(p_member);
  else
    return query select tm.id from team_members tm
      where tm.is_call_pilot and tm.call_pilot_team = any(teams)
        and (p_team is null or tm.call_pilot_team = p_team);
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 4. Functions that now respect the admin's teams
-- ---------------------------------------------------------------------
-- Who am I: teams = the caller's teams
create or replace function public.cp_me() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r text := public.cp_require(); a app_users%rowtype; m team_members%rowtype; today date := public.cp_list_today();
  months jsonb;
begin
  select * into a from app_users where email = public.cp_email();
  select * into m from team_members where id = public.cp_member_id();
  select jsonb_agg(to_char(x, 'YYYY-MM') order by x desc) into months from (
    select generate_series(date_trunc('month', today) - interval '11 months', date_trunc('month', today), interval '1 month')::date as x
    union
    select distinct date_trunc('month', i.interview_date)::date from interviews i
     where i.interview_date is not null and i.interview_date < date_trunc('month', today) - interval '11 months'
       and (i.tool_drive_member_id in (select public.cp_scope()) or i.call_support_1 in (select public.cp_scope())
            or i.call_support_2 in (select public.cp_scope()))) s;
  return jsonb_build_object(
    'email', a.email, 'name', coalesce(m.name, a.name, a.email), 'role', r, 'isAdmin', r in ('admin','super_admin'),
    'isSuper', r = 'super_admin', 'memberId', m.id, 'team', m.call_pilot_team, 'today', today,
    'months', coalesce(months, '[]'::jsonb), 'teams', to_jsonb(public.cp_my_teams()));
end $$;

-- Admin: Call Pilots members of the caller's teams (super admin: every team member)
create or replace function public.cp_members() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sup boolean := public.cp_is_super(); teams text[] := public.cp_my_teams();
begin
  perform public.cp_require(true);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', tm.id, 'name', tm.name, 'email', tm.email,
            'isCallPilot', tm.is_call_pilot, 'team', tm.call_pilot_team, 'isToolDrive', tm.is_tool_drive,
            'isCallSupport', tm.is_call_support) order by tm.is_call_pilot desc, tm.name), '[]'::jsonb)
            from team_members tm
           where sup or tm.call_pilot_team = any(teams));
end $$;

-- Admin: interviews on one list day that are unassigned or assigned within the caller's teams
create or replace function public.cp_day_calls(p_date date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare sup boolean := public.cp_is_super(); teams text[] := public.cp_my_teams();
begin
  perform public.cp_require(true);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'time', to_char(i.interview_time, 'HH24:MI'),
            'candidate', cd.name, 'client', cl.name, 'role', i.role, 'round', i.round, 'status', i.interview_status,
            'toolDrive', i.tool_drive, 'toolDriveMemberId', i.tool_drive_member_id, 'duration', i.duration_minutes,
            'rescheduleRequested', i.cp_reschedule_requested_at is not null) order by i.sort_key), '[]'::jsonb)
            from interviews i join candidates cd on cd.id = i.candidate_id join clients cl on cl.id = i.client_id
            left join team_members tm on tm.id = i.tool_drive_member_id
           where i.interview_date = p_date and i.interview_status <> 'Rescheduled'
             and (sup or i.tool_drive_member_id is null or tm.call_pilot_team = any(teams)));
end $$;

-- My calls: an admin may only look at a member of their teams
create or replace function public.cp_my_calls(p_member bigint default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  today date := public.cp_list_today();
  me bigint;
begin
  perform public.cp_require();
  me := case when public.cp_is_admin() and p_member is not null and public.cp_member_in_scope(p_member) then p_member
             else public.cp_member_id() end;
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

-- Admin: mark a team member as a handler of one of the caller's teams
create or replace function public.cp_set_member(p_member bigint, p_is_call_pilot boolean, p_team text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t text := public.cp_clean(p_team); cur text;
begin
  perform public.cp_require(true);
  select call_pilot_team into cur from team_members where id = p_member;
  if not found then raise exception 'Team member not found'; end if;
  if not public.cp_is_super() then
    if cur is not null and not (cur = any(public.cp_my_teams())) then raise exception 'This person is in another team' using errcode = '42501'; end if;
    if t is not null and not (t = any(public.cp_my_teams())) then raise exception 'You can only add people to your own team' using errcode = '42501'; end if;
  end if;
  update team_members set is_call_pilot = coalesce(p_is_call_pilot, false), call_pilot_team = coalesce(t, call_pilot_team) where id = p_member;
  insert into activity_log (actor_email, action, entity, entity_id)
  values (public.cp_email(), 'Call Pilots: ' || case when p_is_call_pilot then 'added handler' else 'removed handler' end
          || coalesce(' (' || t || ')', ''), 'team_member', p_member::text);
  return jsonb_build_object('ok', true);
end $$;

-- Call actions: an admin only for calls of their teams (or not assigned yet)
create or replace function public.cp_update_call(p_id bigint, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  i interviews%rowtype; me bigint := public.cp_member_id(); adm boolean := public.cp_is_admin();
  who text; note text := public.cp_clean(p_note); stamp text;
begin
  perform public.cp_require();
  select * into i from interviews where id = p_id for update;
  if not found then raise exception 'Call not found'; end if;
  if adm and i.tool_drive_member_id is not null and i.tool_drive_member_id is distinct from me
     and not public.cp_member_in_scope(i.tool_drive_member_id) then
    raise exception 'This call belongs to another team' using errcode = '42501';
  end if;
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

-- Tool Drive list: an admin may only assign people of their teams, and only to calls
-- that are unassigned or already within their teams
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
    elsif i.tool_drive_member_id is not null and not public.cp_member_in_scope(i.tool_drive_member_id) then res := 'other_team';
    else
      mid := coalesce(nullif(r->>'memberId', '')::bigint, public.cp_match_member(r->>'name'));
      select name into mname from team_members where id = mid;
      if mname is null then res := 'unknown_person';
      elsif not public.cp_member_in_scope(mid) then res := 'person_in_other_team';
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


-- ---------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------
do $g$
declare f text;
begin
  foreach f in array array['cp_is_super()', 'cp_my_teams()', 'cp_member_in_scope(bigint)', 'trg_app_users_callpilots()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
  end loop;
  grant execute on function public.cp_is_super(), public.cp_my_teams(), public.cp_member_in_scope(bigint) to authenticated;
  foreach f in array array['cp_me()', 'cp_members()', 'cp_day_calls(date)', 'cp_my_calls(bigint)', 'cp_set_member(bigint,boolean,text)',
                           'cp_update_call(bigint,text,text)', 'cp_assign_tool_drive(date,jsonb,boolean)', 'cp_scope(bigint,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $g$;

-- Check: people per access and team, handlers per team
select 'people' as check, role || ' · ' || array_to_string(portals, '+') || ' · ' || coalesce(nullif(array_to_string(cp_teams, '+'), ''), 'no team') as value, count(*) as n
  from public.app_users where active group by 2
union all
select 'handlers', coalesce(call_pilot_team, '(no team)'), count(*) from public.team_members where is_call_pilot group by 2
order by 1, 2;
