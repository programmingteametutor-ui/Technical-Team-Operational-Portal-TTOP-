-- =====================================================================
-- TTOP Portal: incentive recipient follows the interview's Tool Drive + "Unassigned" option
-- Run once in Supabase > SQL Editor. Safe on the live database. Paid incentives are never changed.
--
-- Problem: when the Tool Drive on an interview was corrected later, the round-progression incentive
--          kept its FIRST recipient (it was only filled in when empty). Example: rows stuck on one person.
-- Fix:     1. Unpaid progression incentives now follow the current Tool Drive of the previous round:
--             - Tool Drive is a team member  -> that person
--             - Tool Drive is empty           -> Unassigned
--             - Tool Drive is not in our team -> no incentive (removed)
--             Incentives an admin edited by hand (or a POC edit the admin approved) are left as they are.
--          2. Admins can set any unpaid incentive to "Unassigned" (Edit > Recipient > Unassigned).
--          3. Existing unpaid progression incentives are corrected now.
-- =====================================================================

-- 1. Progression incentives follow the previous round's current Tool Drive
create or replace function public.generate_incentives(p_interview bigint) returns void
language plpgsql security definer set search_path = public as $$
declare i interviews%rowtype; p interviews%rowtype; ptd text; lbl text;
begin
  select * into i from interviews where id = p_interview;
  if not found or i.interview_status in ('Cancelled','Date Pending') or i.round = 'Loop'
     or i.interview_date is null then return; end if;

  select * into p from interviews x
   where x.candidate_id = i.candidate_id and x.client_id = i.client_id and x.id <> i.id
     and x.interview_status not in ('Cancelled','Date Pending') and x.interview_date is not null
     and x.round <> 'Loop' and x.round_rank < i.round_rank
   order by x.round_rank desc, x.sort_key desc limit 1;

  if found then
    ptd := btrim(coalesce(p.tool_drive, ''));
    lbl := p.round || ' → ' || i.round;
    if ptd = '' or public.is_team_name(ptd) then
      insert into incentives (candidate_id, client_id, interview_id, round_label, incentive_type, recipient_name, amount, event_date)
      values (i.candidate_id, i.client_id, i.id, lbl, 'Round progression (previous Tool Drive)', ptd,
              case when i.round_rank = 2 then 100 else 500 end, i.interview_date)
      on conflict (candidate_id, client_id, round_label, incentive_type)
      do update set recipient_name = excluded.recipient_name
         where incentives.status = 'Pending' and incentives.approval_status <> 'Pending Approval'
           and incentives.reviewed_by is null                       -- not edited by hand
           and incentives.recipient_name is distinct from excluded.recipient_name;
    else
      -- Tool Drive is not in our team: no incentive
      delete from incentives
       where candidate_id = i.candidate_id and client_id = i.client_id and round_label = lbl
         and incentive_type = 'Round progression (previous Tool Drive)'
         and status = 'Pending' and approval_status <> 'Pending Approval' and reviewed_by is null;
    end if;
  end if;

  if i.round = 'Final' and i.placement_status = 'Placed' then
    perform public._placement_incentives(i.candidate_id, i.client_id, i.tool_drive, i.interview_date, i.id, false);
  end if;
end $$;

-- 2. Admin: set an unpaid incentive to Unassigned (stays unassigned until someone edits it again)
create or replace function public.unassign_incentive(p_id bigint, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare who text := (select auth.jwt() ->> 'email');
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  update incentives set recipient_name = '', approval_status = 'Approved',
         proposed_amount = null, proposed_recipient = null, proposed_by = null,
         edit_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Set to Unassigned'),
         reviewed_by = coalesce(who, 'admin'), reviewed_at = now()
   where id = p_id and status = 'Pending';
  if not found then raise exception 'Only unpaid incentives can be set to Unassigned'; end if;
end $$;
revoke all on function public.unassign_incentive(bigint, text) from public, anon;
grant execute on function public.unassign_incentive(bigint, text) to authenticated;

-- 3. Correct existing unpaid progression incentives (not edited by hand) and show what changed
create temp table _before as
  select id, recipient_name from public.incentives
   where incentive_type = 'Round progression (previous Tool Drive)' and status = 'Pending';
do $$
declare r record;
begin
  for r in select distinct interview_id from public.incentives
            where incentive_type = 'Round progression (previous Tool Drive)' and status = 'Pending'
              and approval_status <> 'Pending Approval' and reviewed_by is null and interview_id is not null loop
    perform public.generate_incentives(r.interview_id);
  end loop;
end $$;

select c.name as candidate, cl.name as client, b.round_label as round,
       coalesce(nullif(bf.recipient_name, ''), '(unassigned)') as was,
       coalesce(nullif(b.recipient_name, ''), '(unassigned)') as now_paid_to, b.amount
  from _before bf
  join public.incentives b on b.id = bf.id
  join public.candidates c on c.id = b.candidate_id join public.clients cl on cl.id = b.client_id
 where bf.recipient_name is distinct from b.recipient_name
order by 1;
select count(*) as removed_because_tool_drive_not_in_team from _before bf
 where not exists (select 1 from public.incentives i where i.id = bf.id);
drop table _before;
