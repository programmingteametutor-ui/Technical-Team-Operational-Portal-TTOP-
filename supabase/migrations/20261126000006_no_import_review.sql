-- =====================================================================
-- No Import Review: interviews are added directly, the card carries the check (2026-11-26)
--
-- interviews.import_check (jsonb, null = nothing to check) is set when an interview is added
-- from the Google Doc sync, a pasted list (TTOP) or Call Pilots Add Interviews and something
-- needs a look:
--   {"newCandidate": true, "newClient": true, "newRole": true, "dupe": <id of the same round>,
--    "src": "Google Doc" | "Pasted list" | "Call Pilots", "by": "..."}
-- TTOP shows it on the interview card ("Use candidate X", "Use client X", "Use role X",
-- "It is a reschedule", "Looks right"); the check is cleared once answered.
--
-- Call Pilots import: nothing waits any more. A second line for a round that already exists is
-- added as a separate interview with "dupe" set (the card asks if it is a reschedule).
-- Old Import Review rows stay in their table until TTOP adds or clears them (Interviews page).
-- Run after 20261126000005. Safe to run again.
-- Supabase > SQL Editor > New query > paste this whole file > Run.
-- =====================================================================

alter table public.interviews add column if not exists import_check jsonb;
create index if not exists interviews_import_check on public.interviews ((import_check is not null)) where import_check is not null;

create or replace function public.cp_import_interviews(p_rows jsonb, p_dry boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; out jsonb := '[]'::jsonb; res text; msg text; who text;
  v_cand text; v_client text; v_role text; v_round text; v_type text; v_date date; v_time time; v_dur int; v_poc text;
  v_notes text; v_tech boolean; v_mode text;
  c_id bigint; cl_id bigint; cl_name text; ex interviews%rowtype; new_id bigint; kind text; has_prev boolean; v_newrole boolean; v_newclient boolean; v_newcand boolean; v_dupe boolean;
  today date := public.cp_list_today();
  n_add int := 0; n_held int := 0; n_skip int := 0; n_rs int := 0; n_fail int := 0;
  types text[] := array['Recruiter','Technical','Hiring Manager','Leadership','Director','Coding',
                        'System Design','Assessment','Presentation','Cultural Fit','Onsite'];
begin
  perform public.cp_require(true);
  who := coalesce((select name from team_members where id = public.cp_member_id()), public.cp_email());
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'p_rows must be a JSON array'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    res := null; msg := null; new_id := null; kind := null; c_id := null; cl_id := null; cl_name := null; v_newrole := false; v_newclient := false; v_newcand := false; v_dupe := false;
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

        if c_id is null then
          -- new candidate: created with name and Technical POC (unless preview), checked afterwards on the interview card
          v_newcand := true;
          if not p_dry then
            begin
              insert into candidates (name, technical_poc_id) values (v_cand, public.cp_match_member(v_poc)) returning id into c_id;
            exception when unique_violation then
              select id into c_id from candidates where public.name_key(name) = public.name_key(v_cand) order by id limit 1;
              v_newcand := false;
            end;
          end if;
        end if;
        if cl_id is null then
          -- new client: created (unless preview), checked afterwards on the interview card
          v_newclient := true; cl_name := v_client;
          if not p_dry then
            begin
              insert into clients (name) values (v_client) returning id, name into cl_id, cl_name;
            exception when unique_violation then
              select id, name into cl_id, cl_name from clients
               where lower(name) = lower(v_client) or (public.client_key(name) <> '' and public.client_key(name) = public.client_key(v_client))
               order by id limit 1;
              v_newclient := false;
            end;
          end if;
        end if;
        -- a role never used before is only flagged
        v_newrole := public.cp_role_key(v_role) <> ''
              and not exists (select 1 from interviews x where public.cp_role_key(x.role) = public.cp_role_key(v_role));

        if kind is null and (cl_id is null or c_id is null) then
          res := 'added';                                                   -- preview with a new candidate / client
        elsif kind is null then
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
            if has_prev and ex.interview_status = 'Date Pending' and v_time is not null then
              -- the list now gives the time of an interview that was waiting for one: fill it in
              if not p_dry then
                update interviews set interview_date = v_date, interview_time = v_time,
                       interview_status = case when v_date < today then 'Completed' else 'Scheduled' end
                 where id = ex.id;
              end if;
              res := 'updated'; new_id := ex.id;
            else
            -- same round already there and the line does not say "reschedule": added as a separate
            -- interview; its card in TTOP asks "Is this a reschedule?"
            v_dupe := has_prev and not (v_mode = 'reschedule' or coalesce(v_notes, '') ~* 'resched');
            if has_prev and v_dupe then has_prev := false; end if;
              if not p_dry then
                insert into interviews (candidate_id, client_id, role, interview_date, interview_time, duration_minutes, round,
                                        interview_type, source, prep_status, interview_status, notes, rescheduled_from, sheet_date,
                                        is_technical, marked_technical_by, import_check)
                values (c_id, cl_id, v_role, case when v_time is null then null else v_date end, v_time, v_dur, v_round,
                        v_type, 'Direct', 'Pending',
                        case when v_time is null then 'Date Pending' when v_date < today then 'Completed' else 'Scheduled' end,
                        public.cp_clean(concat_ws(' · ', v_notes, case when v_time is null then 'Time not in list (' || v_date || ')' end)),
                        case when has_prev then ex.id end, today,
                        v_tech and v_round = 'Round 1', case when v_tech and v_round = 'Round 1' then 'Call Pilots import' end,
                        case when v_newcand or v_newclient or v_newrole or v_dupe then jsonb_strip_nulls(jsonb_build_object(
                          'newCandidate', case when v_newcand then true end, 'newClient', case when v_newclient then true end,
                          'newRole', case when v_newrole then true end, 'dupe', case when v_dupe then ex.id end,
                          'src', 'Call Pilots', 'by', who)) end)
                returning id into new_id;
                if has_prev then
                  update interviews set interview_status = 'Rescheduled' where id = ex.id;
                end if;
              end if;
              res := case when has_prev then 'rescheduled' else 'added' end;
            end if;
          end if;
        end if;

      end if;
    exception when others then
      res := 'failed'; msg := sqlerrm;
    end;

    if res in ('added', 'updated') then n_add := n_add + 1;
    elsif res = 'rescheduled' then n_rs := n_rs + 1;
    elsif res = 'failed' then n_fail := n_fail + 1;
    else n_skip := n_skip + 1; end if;
    out := out || jsonb_build_array(jsonb_build_object('result', res, 'message', msg, 'interviewId', new_id, 'newRole', v_newrole, 'newClient', v_newclient, 'newCandidate', v_newcand, 'sameRound', v_dupe,
                                    'cand', v_cand, 'client', v_client, 'round', v_round, 'date', v_date));
  end loop;

  if not p_dry and (n_add + n_rs + n_held + n_fail) > 0 then
    insert into activity_log (actor_email, action, entity)
    values (public.cp_email(), format('Call Pilots import: %s added, %s rescheduled, %s skipped, %s failed',
                                      n_add, n_rs, n_skip, n_fail), 'interviews');
  end if;
  return jsonb_build_object('dry', p_dry, 'added', n_add, 'rescheduled', n_rs, 'review', n_held, 'skipped', n_skip,
                            'failed', n_fail, 'rows', out);
end $$;

revoke all on function public.cp_import_interviews(jsonb, boolean) from public, anon;
grant execute on function public.cp_import_interviews(jsonb, boolean) to authenticated;

-- let the API see the new functions straight away
notify pgrst, 'reload schema';
