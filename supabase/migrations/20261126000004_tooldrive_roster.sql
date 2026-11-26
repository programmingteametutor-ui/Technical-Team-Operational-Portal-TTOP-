-- =====================================================================
-- Tool Drive roster in both portals (2026-11-26)
--
-- The team board (HYD, Pradeep Anna, Development, Marketing, Sai, Sandeep Anna) becomes the
-- Tool Drive list:
--   * TTOP: team_members.is_tool_drive = true (TTOP's Tool Drive suggestions)
--   * Call Pilots: team = Pradeep Anna / HYD (handlers, on the dashboards) or the other
--     team's name (Tool Drive only, no app access).
-- Each name is linked to the person already in TTOP's team list when it is clearly them
-- (same name, or first name + initial with only one person fitting: "Pavan M" -> "Pavan
-- Mockname"); the short name is kept as tool_drive_alias so pasted lists find them. Otherwise
-- the person is added. The result table shows what happened to every name.
--
-- Also: Assign Interviews may use ANY team member (not only people already in the Tool
-- Drive list), as long as they are not in the other Call Pilots team.
-- Run after 20261126000003. Safe to run again.
-- Supabase > SQL Editor > New query > paste this whole file > Run.
-- =====================================================================

alter table public.team_members add column if not exists tool_drive_alias text;
create or replace function public.cp_is_cp_team(t text) returns boolean
language sql immutable as $$ select t in ('Pradeep Anna','HYD') $$;

-- Tool Drive text -> member: exact name, exact alias, else a first name only one person has
create or replace function public.cp_match_member(p text) returns bigint
language sql stable security definer set search_path = public as $$
  with n as (select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')) as v)
  select coalesce(
    (select min(tm.id) from team_members tm, n
      where n.v <> '' and lower(regexp_replace(btrim(tm.name), '\s+', ' ', 'g')) = n.v having count(*) = 1),
    (select min(tm.id) from team_members tm, n
      where n.v <> '' and lower(regexp_replace(btrim(coalesce(tm.tool_drive_alias, '')), '\s+', ' ', 'g')) = n.v having count(*) = 1),
    (select min(tm.id) from team_members tm, n
      where n.v <> '' and position(' ' in n.v) = 0 and lower(split_part(btrim(tm.name), ' ', 1)) = n.v having count(*) = 1)) $$;
revoke all on function public.cp_match_member(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- The roster
-- ---------------------------------------------------------------------
create temp table if not exists cp_roster_out (name text, team text, result text, member text, mid bigint);
truncate cp_roster_out;

do $roster$
declare
  r record; mid bigint; how text; words text[]; nfit int; base text; e text; k int;
begin
  -- names with an initial first ("Karthik D" before "Karthik"), so a one-word name never takes
  -- a person that a more specific name already claimed
  for r in select name, team from (values
    ('Akhil','HYD'), ('Anji','HYD'), ('Karthikeya','HYD'), ('Stephen','HYD'), ('Uday','HYD'), ('Vamshidhar','HYD'),
    ('Avinash','Pradeep Anna'), ('Bharath','Pradeep Anna'), ('Dhruva','Pradeep Anna'), ('Karthik','Pradeep Anna'),
    ('Naresh','Pradeep Anna'), ('Pradeep Anna','Pradeep Anna'),
    ('Dilip B','Development'), ('Gopal','Development'), ('Gopi','Development'), ('Karthik D','Development'),
    ('Kishore','Development'), ('Kumar','Development'), ('N Sai','Development'), ('Pavan M','Development'), ('Vamsi P','Development'),
    ('Sameer','Marketing'), ('Uday D','Marketing'),
    ('Sai','Sai'),
    ('Sandeep Anna','Sandeep Anna')
  ) as t(name, team) order by cardinality(regexp_split_to_array(btrim(name), '\s+')) desc, name loop
    mid := null; how := null; nfit := 0;
    words := regexp_split_to_array(lower(btrim(r.name)), '\s+');
    -- 1. same name or same alias
    select id into mid from team_members tm
     where (lower(btrim(tm.name)) = lower(r.name) or lower(btrim(coalesce(tm.tool_drive_alias, ''))) = lower(r.name))
       and tm.id not in (select o.mid from cp_roster_out o where o.mid is not null)
     order by (lower(btrim(tm.name)) = lower(r.name)) desc, tm.id limit 1;
    if mid is not null then how := 'already there';
    else
      -- 2. one person fits: "First Initial" ("Pavan M" -> "Pavan Mockname"), or a one-word first name
      --    only one person has; never someone already claimed by another name on this board
      select count(*), min(tm.id) into nfit, mid from team_members tm
       where split_part(lower(btrim(tm.name)), ' ', 1) = words[1]
         and tm.id not in (select o.mid from cp_roster_out o where o.mid is not null)
         and coalesce(tm.tool_drive_alias, '') = ''
         and (cardinality(words) = 1
              or (cardinality(regexp_split_to_array(lower(btrim(tm.name)), '\s+')) >= 2
                  and (regexp_split_to_array(lower(btrim(tm.name)), '\s+'))[2] like words[2] || '%'));
      if nfit = 1 then
        how := 'linked to an existing person (alias "' || r.name || '")';
        update team_members set tool_drive_alias = r.name where id = mid;
      else
        mid := null;
      end if;
    end if;
    if mid is null then
      -- 3. new person in the team list (no login)
      base := btrim(regexp_replace(lower(r.name), '[^a-z0-9]+', '.', 'g'), '.'); e := base || '@tooldrive.invalid'; k := 0;
      while exists (select 1 from team_members where lower(email) = e) loop k := k + 1; e := base || '.' || k || '@tooldrive.invalid'; end loop;
      insert into team_members (name, email) values (r.name, e) returning id into mid;
      how := case when nfit > 1 then 'added (several people fit "' || r.name || '", none chosen)' else 'added' end;
    end if;
    update team_members set is_tool_drive = true, call_pilot_team = r.team, is_call_pilot = public.cp_is_cp_team(r.team) where id = mid;
    insert into cp_roster_out
    select r.name, r.team, how, tm.name || case when tm.email like '%@tooldrive.invalid' then ' (no login)' else ' <' || tm.email || '>' end, mid
      from team_members tm where tm.id = mid;
  end loop;
end $roster$;

-- ---------------------------------------------------------------------
-- Assign Interviews: any team member may be a Tool Drive, unless they are in the
-- other Call Pilots team; the Tool Drive list shows everyone (with their alias)
-- ---------------------------------------------------------------------
create or replace function public.cp_member_assignable(p_member bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select p_member is not null and (public.cp_member_in_scope(p_member) or exists (
    select 1 from team_members tm where tm.id = p_member
       and (tm.call_pilot_team is null or not public.cp_is_cp_team(tm.call_pilot_team)))) $$;

create or replace function public.cp_members() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sup boolean := public.cp_is_super(); teams text[] := public.cp_my_teams();
begin
  perform public.cp_require(true);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', tm.id, 'name', tm.name, 'alias', tm.tool_drive_alias,
            'email', case when tm.email like '%@tooldrive.invalid' then '' else tm.email end,
            'isCallPilot', tm.is_call_pilot, 'team', tm.call_pilot_team,
            'toolDriveTeam', tm.call_pilot_team is not null and not public.cp_is_cp_team(tm.call_pilot_team),
            'isToolDrive', tm.is_tool_drive, 'isCallSupport', tm.is_call_support) order by tm.call_pilot_team nulls last, tm.name), '[]'::jsonb)
            from team_members tm
           where sup or tm.call_pilot_team = any(teams) or tm.call_pilot_team is null or not public.cp_is_cp_team(tm.call_pilot_team));
end $$;

do $g$
begin
  revoke all on function public.cp_members(), public.cp_member_assignable(bigint) from public, anon;
  grant execute on function public.cp_members(), public.cp_member_assignable(bigint) to authenticated;
end $g$;

-- Result: what happened to every name on the board
select team, name, result, member from cp_roster_out order by team, name;

-- let the API see the new functions straight away
notify pgrst, 'reload schema';
