-- =====================================================================
-- TTOP Portal: "Add to my list" for 1st-round interviews
-- A team member takes a 1st-round interview of any Technical POC: they become its Tool Drive,
-- so it shows in their lists. "Remove from my list" clears it again (admins can clear anyone's).
-- Safe on the live database and safe to run again. Supabase > SQL Editor > paste > Run.
-- =====================================================================
create or replace function public.claim_interview(p_id bigint, p_take boolean)
returns text language plpgsql security definer set search_path = public as $$
declare me text; i interviews%rowtype; td text;
begin
  select name into me from team_members where id = public.my_member_id();
  if me is null and not public.is_admin() then raise exception 'Only team members can take interviews'; end if;
  select * into i from interviews where id = p_id;
  if not found then raise exception 'Interview not found'; end if;
  if i.round <> 'Round 1' and not public.is_admin() then raise exception 'Only 1st-round interviews can be taken here'; end if;
  if i.interview_status in ('Cancelled','Rescheduled') then raise exception 'This interview is %', lower(i.interview_status); end if;
  td := btrim(coalesce(i.tool_drive, ''));
  if p_take then
    if me is null then raise exception 'Your login is not linked to a team member'; end if;
    if td <> '' and lower(td) <> lower(me) and lower(split_part(td, ' ', 1)) <> lower(split_part(me, ' ', 1)) then
      raise exception 'Already in %''s list', td;
    end if;
    update interviews set tool_drive = me where id = p_id;
    return me;
  else
    if td <> '' and not public.is_admin() and lower(td) <> lower(coalesce(me, '')) and lower(split_part(td, ' ', 1)) <> lower(split_part(coalesce(me, ''), ' ', 1)) then
      raise exception 'Only % or an admin can remove it', td;
    end if;
    update interviews set tool_drive = null where id = p_id;
    return '';
  end if;
end $$;
revoke all on function public.claim_interview(bigint, boolean) from public, anon;
grant execute on function public.claim_interview(bigint, boolean) to authenticated;
