-- =====================================================================
-- Call Pilots shows only its two teams: Pradeep Anna and HYD (2026-11-25)
--
-- The first migration marked everyone in the old Dhruva user list as a handler with
-- their old team name (Development, Marketing, ...), so those teams showed up in the
-- portal. Now:
--   * only Pradeep Anna and HYD people are handlers (dashboards, filters, team lists);
--   * people of other teams stay in the Tool Drive list only, as "Other" (no team shown,
--     no app access), so a pasted Tool Drive line naming them still assigns the call
--     and TTOP's incentives still reach them.
-- Run after 20261125000004. Safe to run again.
-- Supabase > SQL Editor > New query > paste this whole file > Run.
-- =====================================================================

-- (also in 20261125000004; repeated so this file works even if run on its own)
create or replace function public.cp_is_cp_team(t text) returns boolean
language sql immutable as $$ select t in ('Pradeep Anna','HYD') $$;
alter table public.team_members add column if not exists is_call_pilot boolean not null default false;
alter table public.team_members add column if not exists call_pilot_team text;

-- 1. Other teams: not handlers; kept as "Other" Tool Drive people
update public.team_members
   set is_call_pilot = false, call_pilot_team = 'Other'
 where call_pilot_team is not null and not public.cp_is_cp_team(call_pilot_team) and call_pilot_team <> 'Other';
update public.team_members set is_call_pilot = false
 where is_call_pilot and (call_pilot_team is null or not public.cp_is_cp_team(call_pilot_team));

-- 2. Every team list in the portal (super admins included): the two teams only
create or replace function public.cp_my_teams() returns text[]
language sql stable security definer set search_path = public as $$
  select case
    when public.cp_role() is null then '{}'::text[]
    when public.cp_role() = 'super_admin' then array['HYD','Pradeep Anna']
    else array(select t from unnest(coalesce((select a.cp_teams from app_users a where a.email = public.cp_email()), '{}')) t
                where public.cp_is_cp_team(t)) end $$;

-- 3. Handlers can only be in the two teams; anyone else added is an "Other" Tool Drive person
create or replace function public.cp_add_tool_drive_person(p_name text, p_team text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n text := public.cp_clean(p_name); t text := coalesce(public.cp_clean(p_team), 'Other'); mid bigint; cur text; base text; e text; k int := 0;
begin
  perform public.cp_require(true);
  if n is null then raise exception 'Enter a name'; end if;
  if not public.cp_is_cp_team(t) then t := 'Other'; end if;
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
  values (public.cp_email(), 'Call Pilots: Tool Drive list - ' || n || case when t = 'Other' then ' (other team)' else ' in ' || t end, 'team_member', mid::text);
  return jsonb_build_object('ok', true, 'id', mid);
end $$;

-- 4. Marking a handler by hand: only into Pradeep Anna or HYD
create or replace function public.cp_set_member(p_member bigint, p_is_call_pilot boolean, p_team text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t text := public.cp_clean(p_team); cur text;
begin
  perform public.cp_require(true);
  select call_pilot_team into cur from team_members where id = p_member;
  if not found then raise exception 'Team member not found'; end if;
  if t is not null and not public.cp_is_cp_team(t) then raise exception 'Call Pilots teams are Pradeep Anna and HYD'; end if;
  if not public.cp_is_super() then
    if cur is not null and public.cp_is_cp_team(cur) and not (cur = any(public.cp_my_teams())) then raise exception 'This person is in another team' using errcode = '42501'; end if;
    if t is not null and not (t = any(public.cp_my_teams())) then raise exception 'You can only add people to your own team' using errcode = '42501'; end if;
  end if;
  update team_members set is_call_pilot = coalesce(p_is_call_pilot, false) and public.cp_is_cp_team(coalesce(t, cur)),
         call_pilot_team = coalesce(t, call_pilot_team) where id = p_member;
  insert into activity_log (actor_email, action, entity, entity_id)
  values (public.cp_email(), 'Call Pilots: ' || case when p_is_call_pilot then 'added handler' else 'removed handler' end
          || coalesce(' (' || t || ')', ''), 'team_member', p_member::text);
  return jsonb_build_object('ok', true);
end $$;

do $g$
begin
  revoke all on function public.cp_my_teams(), public.cp_add_tool_drive_person(text,text), public.cp_set_member(bigint,boolean,text) from public, anon;
  grant execute on function public.cp_my_teams(), public.cp_add_tool_drive_person(text,text), public.cp_set_member(bigint,boolean,text) to authenticated;
end $g$;

-- Check: handlers per team (only Pradeep Anna and HYD) and "Other" Tool Drive people
select coalesce(call_pilot_team, '(none)') as team, count(*) filter (where is_call_pilot) as handlers, count(*) as people
  from public.team_members where call_pilot_team is not null group by 1 order by 1;
