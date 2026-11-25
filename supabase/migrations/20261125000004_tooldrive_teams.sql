-- =====================================================================
-- Tool Drive teams + saving People never fails (2026-11-25)
--
-- 1. TTOP's rule "no two team members share a first name" (index team_first_name_uniq)
--    blocks the real roster (Karthik / Karthik D, Uday / Uday D). It was only needed
--    for first-name incentive matching; TTOP's resolve_recipient now takes the exact
--    full name and never guesses a shared first name, and Call Pilots uses member ids.
--    So the rule is dropped.
-- 2. Saving a person on People links them to the Tool Drive list (team_members). If
--    that link fails for any reason the save still succeeds (People shows "not linked").
-- 3. Tool Drive teams: people of other teams (Development, Marketing, Sai, Sandeep Anna, ...)
--    can be the Tool Drive of a call without any app access. They live only in the Tool
--    Drive list (team_members.call_pilot_team = their team, is_call_pilot = false), are
--    matched when the Tool Drive list is pasted, and get incentives through TTOP as before.
--    Call Pilots handlers (Pradeep Anna, HYD) stay the only ones on the dashboards.
--
-- Run after 20261125000003. Safe to run again.
-- Supabase > SQL Editor > New query > paste this whole file > Run.
-- =====================================================================

drop index if exists public.team_first_name_uniq;

-- The two Call Pilots teams (people with app access). Every other team is a Tool Drive team.
create or replace function public.cp_is_cp_team(t text) returns boolean
language sql immutable as $$ select t in ('Pradeep Anna','HYD') $$;

-- ---------------------------------------------------------------------
-- People -> Tool Drive list; never blocks the save
-- ---------------------------------------------------------------------
create or replace function public.trg_app_users_callpilots() returns trigger
language plpgsql security definer set search_path = public as $$
declare mid bigint; team text; nm text;
begin
  begin
    if tg_op = 'DELETE' then
      update team_members set is_call_pilot = false where lower(btrim(email)) = old.email;
      return old;
    end if;
    if new.role = 'super_admin' then return new; end if;
    select id, call_pilot_team into mid, team from team_members where lower(btrim(email)) = new.email order by id limit 1;
    nm := coalesce(public.cp_clean(new.name), split_part(new.email, '@', 1));
    if mid is null then
      -- added earlier from the Tool Drive list without a login: same name -> link it
      select id, call_pilot_team into mid, team from team_members
       where lower(btrim(name)) = lower(nm) and email like '%@tooldrive.invalid' order by id limit 1;
      if mid is not null then update team_members set email = new.email where id = mid; end if;
    end if;
    if new.active and 'callpilots' = any(new.portals) and cardinality(new.cp_teams) > 0 then
      team := case when team = any(new.cp_teams) then team else new.cp_teams[1] end;
      if mid is null then
        insert into team_members (name, email, is_call_pilot, call_pilot_team) values (nm, new.email, true, team);
      else
        update team_members set is_call_pilot = true, call_pilot_team = team where id = mid;
      end if;
    elsif mid is not null then
      update team_members set is_call_pilot = false where id = mid;
    end if;
  exception when others then
    raise warning 'Call Pilots: % not linked to the Tool Drive list: %', coalesce(new.email, old.email), sqlerrm;
  end;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- ---------------------------------------------------------------------
-- Who may be assigned as Tool Drive by the caller:
--   people of the caller's Call Pilots teams, and anyone in a Tool Drive team
-- ---------------------------------------------------------------------
create or replace function public.cp_member_assignable(p_member bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select p_member is not null and (public.cp_member_in_scope(p_member) or exists (
    select 1 from team_members tm where tm.id = p_member and tm.call_pilot_team is not null
       and not public.cp_is_cp_team(tm.call_pilot_team))) $$;

-- Admin: the Tool Drive list = the caller's Call Pilots teams + every Tool Drive team
create or replace function public.cp_members() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sup boolean := public.cp_is_super(); teams text[] := public.cp_my_teams();
begin
  perform public.cp_require(true);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', tm.id, 'name', tm.name,
            'email', case when tm.email like '%@tooldrive.invalid' then '' else tm.email end,
            'isCallPilot', tm.is_call_pilot, 'team', tm.call_pilot_team,
            'toolDriveTeam', tm.call_pilot_team is not null and not public.cp_is_cp_team(tm.call_pilot_team),
            'isToolDrive', tm.is_tool_drive, 'isCallSupport', tm.is_call_support) order by tm.call_pilot_team nulls last, tm.name), '[]'::jsonb)
            from team_members tm
           where sup or tm.call_pilot_team = any(teams)
              or (tm.call_pilot_team is not null and not public.cp_is_cp_team(tm.call_pilot_team)));
end $$;

-- Admin: the day's calls: unassigned, assigned within the caller's teams, or to a Tool Drive team
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
             and (sup or i.tool_drive_member_id is null or tm.call_pilot_team = any(teams)
                  or (tm.call_pilot_team is not null and not public.cp_is_cp_team(tm.call_pilot_team))));
end $$;

-- Tool Drive list: the person may also be from a Tool Drive team
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
    elsif i.tool_drive_member_id is not null and not public.cp_member_assignable(i.tool_drive_member_id) then res := 'other_team';
    else
      mid := coalesce(nullif(r->>'memberId', '')::bigint, public.cp_match_member(r->>'name'));
      select name into mname from team_members where id = mid;
      if mname is null then res := 'unknown_person';
      elsif not public.cp_member_assignable(mid) then res := 'person_in_other_team';
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

-- Admin: add a person to the Tool Drive list (no login needed).
--   Same name already there -> that person is moved to the team (never a duplicate).
--   Pradeep Anna / HYD people normally come from People; an admin may add only to their own team.
create or replace function public.cp_add_tool_drive_person(p_name text, p_team text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n text := public.cp_clean(p_name); t text := public.cp_clean(p_team); mid bigint; cur text; base text; e text; k int := 0;
begin
  perform public.cp_require(true);
  if n is null or t is null then raise exception 'Enter a name and a team'; end if;
  if public.cp_is_cp_team(t) and not public.cp_is_super() and not (t = any(public.cp_my_teams())) then
    raise exception 'You can only add people to your own Call Pilots team' using errcode = '42501';
  end if;
  select id, call_pilot_team into mid, cur from team_members where lower(btrim(name)) = lower(n) order by id limit 1;
  if mid is not null then
    if cur is not null and public.cp_is_cp_team(cur) and not public.cp_member_in_scope(mid) then
      raise exception '% is in another Call Pilots team', n using errcode = '42501';
    end if;
    update team_members set call_pilot_team = t, is_call_pilot = public.cp_is_cp_team(t) where id = mid;
  else
    base := btrim(regexp_replace(lower(n), '[^a-z0-9]+', '.', 'g'), '.');
    e := base || '@tooldrive.invalid';
    while exists (select 1 from team_members where lower(email) = e) loop k := k + 1; e := base || '.' || k || '@tooldrive.invalid'; end loop;
    insert into team_members (name, email, call_pilot_team, is_call_pilot) values (n, e, t, public.cp_is_cp_team(t)) returning id into mid;
  end if;
  insert into activity_log (actor_email, action, entity, entity_id)
  values (public.cp_email(), 'Call Pilots: Tool Drive list - ' || n || ' in ' || t, 'team_member', mid::text);
  return jsonb_build_object('ok', true, 'id', mid);
end $$;

-- Admin: take a person off the Tool Drive list (their past calls and incentives stay)
create or replace function public.cp_remove_tool_drive_person(p_member bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n text;
begin
  perform public.cp_require(true);
  if not public.cp_member_assignable(p_member) then raise exception 'This person is in another team' using errcode = '42501'; end if;
  update team_members set call_pilot_team = null, is_call_pilot = false where id = p_member returning name into n;
  insert into activity_log (actor_email, action, entity, entity_id)
  values (public.cp_email(), 'Call Pilots: Tool Drive list - removed ' || coalesce(n, ''), 'team_member', p_member::text);
  return jsonb_build_object('ok', true);
end $$;

do $g$
declare f text;
begin
  foreach f in array array['cp_members()', 'cp_day_calls(date)', 'cp_assign_tool_drive(date,jsonb,boolean)',
                           'cp_add_tool_drive_person(text,text)', 'cp_remove_tool_drive_person(bigint)', 'cp_member_assignable(bigint)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  revoke all on function public.trg_app_users_callpilots() from public, anon, authenticated;
end $g$;

-- Link everyone already saved on People (now that first names may repeat)
update public.app_users set cp_teams = cp_teams where 'callpilots' = any(portals) and role <> 'super_admin';

-- Check: the Tool Drive list per team
select coalesce(call_pilot_team, '(none)') as team, count(*) filter (where is_call_pilot) as handlers, count(*) as people
  from public.team_members where call_pilot_team is not null group by 1 order by 1;
