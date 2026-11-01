-- =====================================================================
-- TTOP Portal: placement incentive rule for candidates who were ALREADY placed earlier
-- Run once in Supabase > SQL Editor. Safe on the live database (no data is deleted except
-- unpaid Candidate POC placement incentives that the new rule no longer allows).
--
-- Rule: if the candidate was already placed with ANOTHER client in an EARLIER month
--       (e.g. placed in July, placed again in October), the October placement pays
--       NO Candidate POC incentive. The Tool Drive still gets their 2,000.
--       (If the Tool Drive and the POC are the same person, they get the Tool Drive 2,000 only, not 4,000.)
-- "Placed earlier" = a closer-list entry in an earlier month, or a Final interview marked Placed
-- with an earlier date, for a different client.
-- Paid incentives are never changed.
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

-- Apply the rule to repeat placements already in the portal (unpaid incentives only; other placements are not touched).
-- Interviews first, then closer lists (closer lists set the payout month, as before).
do $$
declare r record;
begin
  -- only placements of candidates who were already placed with another client in an earlier month
  for r in select i.candidate_id, i.client_id, i.tool_drive, i.interview_date, i.id from public.interviews i
            where i.round = 'Final' and i.placement_status = 'Placed' and i.interview_date is not null
              and (exists (select 1 from public.closers c where c.candidate_id = i.candidate_id and c.client_id <> i.client_id
                             and c.closer_month < date_trunc('month', i.interview_date))
                or exists (select 1 from public.interviews x where x.candidate_id = i.candidate_id and x.client_id <> i.client_id
                             and x.round = 'Final' and x.placement_status = 'Placed' and x.interview_date < date_trunc('month', i.interview_date))) loop
    perform public._placement_incentives(r.candidate_id, r.client_id, r.tool_drive, r.interview_date, r.id, false);
  end loop;
  for r in select k.candidate_id, k.client_id, k.tool_drive, k.closer_month from public.closers k
            where exists (select 1 from public.closers c where c.candidate_id = k.candidate_id and c.client_id <> k.client_id
                            and c.closer_month < k.closer_month)
               or exists (select 1 from public.interviews x where x.candidate_id = k.candidate_id and x.client_id <> k.client_id
                            and x.round = 'Final' and x.placement_status = 'Placed' and x.interview_date < k.closer_month) loop
    perform public._placement_incentives(r.candidate_id, r.client_id, r.tool_drive,
            (r.closer_month + interval '1 month - 1 day')::date, null, true);
  end loop;
end $$;

-- Check: repeat placements and what each one now pays
select c.name as candidate, cl.name as client, i.incentive_type, i.recipient_name, i.amount, i.event_date, i.status
  from public.incentives i join public.candidates c on c.id = i.candidate_id join public.clients cl on cl.id = i.client_id
 where i.incentive_type like 'Final + Placed%'
   and exists (select 1 from public.closers k where k.candidate_id = i.candidate_id and k.client_id <> i.client_id
               and k.closer_month < date_trunc('month', i.event_date))
 order by c.name, i.event_date;
