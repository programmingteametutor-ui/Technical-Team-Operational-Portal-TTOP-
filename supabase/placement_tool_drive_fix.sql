-- =====================================================================
-- TTOP Portal: placement incentive was missing the Tool Drive
-- Run once in Supabase > SQL Editor. Safe on the live database. Paid incentives are never changed.
--
-- Cause: a closer list takes the Tool Drive from the interview at the moment it is added.
--        If the Tool Drive was filled in on the interview later, the placement was never recalculated,
--        so the Tool Drive share stayed "Unassigned" (or the 4,000 for Tool Drive = POC was not used).
-- Fix:   1. The placement calculation takes the Tool Drive from the interview when none was given.
--        2. Changing the Tool Drive on an interview recalculates that candidate's placement with that client.
--        3. Existing placements are corrected now.
-- Includes the "already placed in an earlier month" rule (incentive_repeat_placement.sql).
-- =====================================================================

create or replace function public._placement_incentives(
  p_cand bigint, p_client bigint, p_td text, p_date date, p_int bigint, p_move_date boolean)
returns void language plpgsql security definer set search_path = public as $$
declare poc_name text; td text := btrim(coalesce(p_td, '')); td_team boolean; same boolean; earlier boolean;
  m0 date := date_trunc('month', p_date)::date;
begin
  if exists (select 1 from incentives where candidate_id = p_cand and client_id = p_client
             and round_label = 'Final' and incentive_type like 'Final + Placed%' and status = 'Paid') then
    return;
  end if;
  -- NEW: no Tool Drive given (e.g. it was added to the interview after the closer list) -> take it from the interview
  if td = '' then
    select btrim(x.tool_drive) into td from interviews x
     where x.candidate_id = p_cand and x.client_id = p_client and coalesce(btrim(x.tool_drive), '') <> ''
       and coalesce(x.interview_status, '') not in ('Cancelled', 'Rescheduled') and coalesce(x.round, '') <> 'Loop'
     order by (x.placement_status = 'Placed') desc nulls last, (x.round = 'Final') desc nulls last, x.interview_date desc nulls last, x.id desc
     limit 1;
    td := coalesce(td, '');
  end if;
  select tm.name into poc_name from candidates c
    join team_members tm on tm.id = c.technical_poc_id where c.id = p_cand;
  td_team := td <> '' and public.is_team_name(td);
  same := td_team and poc_name is not null
          and lower(split_part(td, ' ', 1)) = lower(split_part(poc_name, ' ', 1));

  -- NEW: already placed with another client in an earlier month -> no Candidate POC incentive
  earlier := exists (select 1 from closers c where c.candidate_id = p_cand and c.client_id <> p_client and c.closer_month < m0)
          or exists (select 1 from interviews x where x.candidate_id = p_cand and x.client_id <> p_client
                       and x.round = 'Final' and x.placement_status = 'Placed' and x.interview_date < m0);
  if earlier then
    delete from incentives
     where candidate_id = p_cand and client_id = p_client and round_label = 'Final'
       and status = 'Pending' and approval_status <> 'Pending Approval'
       and incentive_type in ('Final + Placed (Candidate POC)', 'Final + Placed (Tool Drive & Candidate POC)');
    poc_name := null;     -- POC share is not paid
    same := false;        -- Tool Drive gets the normal 2,000 (never the combined 4,000)
  end if;

  -- remove unpaid rows that no longer fit the current Tool Drive / POC situation
  delete from incentives
   where candidate_id = p_cand and client_id = p_client and round_label = 'Final'
     and status = 'Pending' and approval_status <> 'Pending Approval'
     and ( (same and incentive_type in ('Final + Placed (Tool Drive)', 'Final + Placed (Candidate POC)'))
        or (not same and incentive_type = 'Final + Placed (Tool Drive & Candidate POC)')
        or (td <> '' and not td_team and incentive_type = 'Final + Placed (Tool Drive)' and recipient_name = '') );

  if same then
    insert into incentives (candidate_id, client_id, interview_id, round_label, incentive_type, recipient_name, amount, event_date)
    values (p_cand, p_client, p_int, 'Final', 'Final + Placed (Tool Drive & Candidate POC)', td, 4000, p_date)
    on conflict (candidate_id, client_id, round_label, incentive_type)
    do update set event_date = excluded.event_date where p_move_date and incentives.status = 'Pending';
  else
    if td = '' or td_team then
      insert into incentives (candidate_id, client_id, interview_id, round_label, incentive_type, recipient_name, amount, event_date)
      values (p_cand, p_client, p_int, 'Final', 'Final + Placed (Tool Drive)', td, 2000, p_date)
      on conflict (candidate_id, client_id, round_label, incentive_type)
      do update set
        recipient_name = case when incentives.recipient_name = '' then excluded.recipient_name else incentives.recipient_name end,
        event_date = case when p_move_date and incentives.status = 'Pending' then excluded.event_date else incentives.event_date end;
    end if;
    if poc_name is not null then
      insert into incentives (candidate_id, client_id, interview_id, round_label, incentive_type, recipient_name, amount, event_date)
      values (p_cand, p_client, p_int, 'Final', 'Final + Placed (Candidate POC)', poc_name, 2000, p_date)
      on conflict (candidate_id, client_id, round_label, incentive_type)
      do update set event_date = case when p_move_date and incentives.status = 'Pending' then excluded.event_date else incentives.event_date end;
    end if;
  end if;
end $$;
revoke all on function public._placement_incentives(bigint, bigint, text, date, bigint, boolean) from public, anon, authenticated;

-- 2. Tool Drive filled in or changed on an interview -> recalculate the placement for that candidate + client
create or replace function public.trg_placement_td_follow() returns trigger
language plpgsql security definer set search_path = public as $$
declare k record;
begin
  if new.tool_drive is distinct from old.tool_drive then
    for k in select * from closers where candidate_id = new.candidate_id and client_id = new.client_id loop
      if coalesce(btrim(k.tool_drive), '') = '' and coalesce(btrim(new.tool_drive), '') <> '' then
        update closers set tool_drive = btrim(new.tool_drive) where id = k.id;
        k.tool_drive := btrim(new.tool_drive);
      end if;
      perform public._placement_incentives(k.candidate_id, k.client_id, k.tool_drive,
              (k.closer_month + interval '1 month' - interval '1 day')::date, null, true);
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists interviews_placement_td on public.interviews;
create trigger interviews_placement_td after update of tool_drive on public.interviews
  for each row execute function public.trg_placement_td_follow();

-- 3. Correct existing placements whose Tool Drive share is unassigned or missing (unpaid only)
do $$
declare k record; t text;
begin
  for k in select * from public.closers c
            where not exists (select 1 from public.incentives i where i.candidate_id = c.candidate_id and i.client_id = c.client_id
                                and i.incentive_type like 'Final + Placed%' and i.status = 'Paid')
              and not exists (select 1 from public.incentives i where i.candidate_id = c.candidate_id and i.client_id = c.client_id
                                and i.incentive_type in ('Final + Placed (Tool Drive)', 'Final + Placed (Tool Drive & Candidate POC)')
                                and coalesce(i.recipient_name, '') <> '') loop
    t := nullif(btrim(coalesce(k.tool_drive, '')), '');
    if t is null then
      select btrim(x.tool_drive) into t from public.interviews x
       where x.candidate_id = k.candidate_id and x.client_id = k.client_id and coalesce(btrim(x.tool_drive), '') <> ''
         and coalesce(x.interview_status, '') not in ('Cancelled', 'Rescheduled') and coalesce(x.round, '') <> 'Loop'
       order by (x.placement_status = 'Placed') desc nulls last, (x.round = 'Final') desc nulls last, x.interview_date desc nulls last, x.id desc
       limit 1;
      if t is not null then update public.closers set tool_drive = t where id = k.id; end if;
    end if;
    perform public._placement_incentives(k.candidate_id, k.client_id, t,
            (k.closer_month + interval '1 month' - interval '1 day')::date, null, true);
  end loop;
end $$;

-- Check: placements and who gets paid
select c.name as candidate, cl.name as client, i.incentive_type, coalesce(nullif(i.recipient_name, ''), '(unassigned)') as recipient,
       i.amount, i.event_date, i.status
  from public.incentives i join public.candidates c on c.id = i.candidate_id join public.clients cl on cl.id = i.client_id
 where i.incentive_type like 'Final + Placed%'
 order by i.event_date desc, c.name;
