-- =====================================================================
-- Call Pilots (2026-11-26)
-- 1. Add Interviews: only a new CANDIDATE waits on Import Review. A new client is created
--    and the interview added; a non-blocking "Check" row lets someone confirm the client.
--    (TTOP's Doc sync and pasted lists follow the same rule.)
-- 2. My calls: admins see all calls of their teams plus unassigned calls (super admin: all).
-- Replaces cp_import_interviews and cp_my_calls. Run after 20261125000005 (and before or after the archive file). Safe to run again.
-- Supabase > SQL Editor > New query > paste this whole file > Run.
-- =====================================================================

-- Admin: import parsed Doc / WhatsApp lines (page 4).
-- p_rows: [{cand, client, role, date:'YYYY-MM-DD', time:'HH:MM'|'' , dur:60, round, type, poc, notes, tech, mode:'new'|'reschedule'}]
-- Same rules as TTOP: only a NEW CANDIDATE (and a same-round duplicate) waits on TTOP's Import
-- Review; an identical interview is skipped. A client is matched to an existing one first (same
-- name, "Inc/Ltd" ignored); a client that is still new is created, the interview is added, and a
-- non-blocking "Check" row goes to Import Review. A new role never stops a line (newRole flag). Running the
-- same paste twice creates nothing new. p_dry = preview only (nothing is written).
create or replace function public.cp_import_interviews(p_rows jsonb, p_dry boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; out jsonb := '[]'::jsonb; res text; msg text; who text;
  v_cand text; v_client text; v_role text; v_round text; v_type text; v_date date; v_time time; v_dur int; v_poc text;
  v_notes text; v_tech boolean; v_mode text;
  c_id bigint; cl_id bigint; cl_name text; ex interviews%rowtype; new_id bigint; kind text; has_prev boolean; v_newrole boolean; v_newclient boolean;
  today date := public.cp_list_today();
  n_add int := 0; n_held int := 0; n_skip int := 0; n_rs int := 0; n_fail int := 0;
  types text[] := array['Recruiter','Technical','Hiring Manager','Leadership','Director','Coding',
                        'System Design','Assessment','Presentation','Cultural Fit','Onsite'];
begin
  perform public.cp_require(true);
  who := coalesce((select name from team_members where id = public.cp_member_id()), public.cp_email());
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'p_rows must be a JSON array'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    res := null; msg := null; new_id := null; kind := null; c_id := null; cl_id := null; cl_name := null; v_newrole := false; v_newclient := false;
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
        elsif cl_id is null then
          -- new client: created (unless preview), checked afterwards on Import Review
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

        if kind is null and cl_id is null then
          res := 'added';                                                   -- preview with a new client
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
                if v_newclient then
                  insert into import_review (reason, created_by, payload)
                  values ('fix', who, jsonb_build_object('cand', v_cand, 'role', coalesce(v_role, ''), 'client', cl_name,
                    'date', v_date, 'time', coalesce(to_char(v_time, 'HH24:MI'), ''), 'dur', v_dur || ' Minutes',
                    'round', v_round, 'type', v_type, 'td', '', 'poc', coalesce(v_poc, ''), 'prep', 'Pending',
                    'notes', coalesce(v_notes, ''), 'loc', '', 'rsId', '', 'kind', 'chk', 'iid', new_id::text, 'xid', '',
                    'msg', 'New client “' || cl_name || '” was added', 'hold', '', 'tech', ''));
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
            res := 'review_' || case kind when 'newc' then 'new_candidate' else 'duplicate' end;
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
    out := out || jsonb_build_array(jsonb_build_object('result', res, 'message', msg, 'interviewId', new_id, 'newRole', v_newrole, 'newClient', v_newclient,
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

-- My calls: a handler sees their own calls. An admin sees ALL calls of their teams plus the
-- calls nobody drives yet (super admin: every call), or one handler's calls (p_member).
create or replace function public.cp_my_calls(p_member bigint default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  today date := public.cp_list_today();
  me bigint; adm boolean := public.cp_is_admin(); sup boolean := public.cp_is_super(); teams text[] := public.cp_my_teams();
  all_calls boolean;
begin
  perform public.cp_require();
  all_calls := adm and p_member is null;
  me := case when adm and p_member is not null and public.cp_member_in_scope(p_member) then p_member
             when adm then null else public.cp_member_id() end;
  if not all_calls and me is null then
    return jsonb_build_object('today', today, 'memberId', null, 'all', false, 'calls', '[]'::jsonb);
  end if;
  return jsonb_build_object('today', today, 'memberId', me, 'all', all_calls, 'calls', (
    select coalesce(jsonb_agg(r order by r->>'date', r->>'sort'), '[]'::jsonb) from (
      select jsonb_build_object(
        'id', i.id, 'date', i.interview_date, 'time', to_char(i.interview_time, 'HH24:MI'), 'sort', i.sort_key,
        'candidate', cd.name, 'client', cl.name, 'role', i.role, 'round', i.round, 'type', i.interview_type,
        'duration', i.duration_minutes, 'status', i.interview_status, 'notes', i.notes, 'feedback', i.feedback,
        'myPart', case when all_calls then 'All' when i.tool_drive_member_id = me then 'Tool Drive' else 'Call Support' end,
        'toolDrive', i.tool_drive, 'toolDriveMemberId', i.tool_drive_member_id, 'team', td.call_pilot_team,
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
        left join team_members td on td.id = i.tool_drive_member_id
        left join team_members s1 on s1.id = i.call_support_1
        left join team_members s2 on s2.id = i.call_support_2
       where i.interview_date between today - 30 and today + 6
         and i.interview_status <> 'Rescheduled'
         and (i.interview_date >= today or i.interview_status = 'Scheduled')
         and (case when all_calls then
                sup or i.tool_drive_member_id is null or td.call_pilot_team = any(teams)
              else i.tool_drive_member_id = me or i.call_support_1 = me or i.call_support_2 = me end)) z));
end $$;

revoke all on function public.cp_import_interviews(jsonb, boolean), public.cp_my_calls(bigint) from public, anon;
grant execute on function public.cp_import_interviews(jsonb, boolean), public.cp_my_calls(bigint) to authenticated;
