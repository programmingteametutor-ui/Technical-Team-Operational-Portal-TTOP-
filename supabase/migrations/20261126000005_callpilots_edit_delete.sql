-- =====================================================================
-- Call Pilots: edit and delete calls (2026-11-26)
--
--   * Admins (and super admins) may edit EVERYTHING on a call of their teams, or a call nobody
--     drives yet: candidate, client, role, date, time, duration, round, type, status, Tool Drive,
--     Call Support, notes, feedback. They may also delete the call.
--   * A handler (user) may edit their own calls (they are the Tool Drive): date, time, duration,
--     round, type, role, status, notes, feedback. Not the candidate, client or Tool Drive, and
--     no delete.
--   * Calls page: also shows calls driven by people of other teams (Development, Marketing...)
--     to admins, and returns the Call Support ids for the edit form.
-- Run after 20261126000004. Safe to run again.
-- Supabase > SQL Editor > New query > paste this whole file > Run.
-- =====================================================================

-- May the caller manage this call as an admin? (their teams, unassigned, own, or another team's
-- Tool Drive person who is not in the other Call Pilots team)
create or replace function public.cp_call_in_admin_scope(p_td bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select public.cp_is_admin() and (public.cp_is_super() or p_td is null or p_td = public.cp_member_id()
         or public.cp_member_assignable(p_td)) $$;
revoke all on function public.cp_call_in_admin_scope(bigint) from public, anon, authenticated;

-- p_fields: only the keys that are sent change.
--   date 'YYYY-MM-DD'|'' , time 'HH:MM'|'' , duration, round, type, role, status, notes, feedback
--   admin only: candidate (name), client (name), toolDriveMemberId (id|null), support1, support2 (id|null)
create or replace function public.cp_edit_call(p_id bigint, p_fields jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  i interviews%rowtype; f jsonb := coalesce(p_fields, '{}'::jsonb);
  me bigint := public.cp_member_id(); adm boolean := public.cp_is_admin();
  types text[] := array['Recruiter','Technical','Hiring Manager','Leadership','Director','Coding',
                        'System Design','Assessment','Presentation','Cultural Fit','Onsite'];
  v_date date; v_time time; v_dur int; v_round text; v_type text; v_role text; v_status text; v_notes text; v_fb text;
  v_cand bigint; v_client bigint; v_td bigint; v_tdname text; v_s1 bigint; v_s2 bigint; nm text;
  changed text[] := '{}';
begin
  perform public.cp_require();
  if jsonb_typeof(f) <> 'object' then raise exception 'p_fields must be a JSON object'; end if;
  select * into i from interviews where id = p_id for update;
  if not found then raise exception 'Call not found'; end if;
  if adm then
    if not public.cp_call_in_admin_scope(i.tool_drive_member_id) then
      raise exception 'This call belongs to another team' using errcode = '42501';
    end if;
  elsif me is null or i.tool_drive_member_id is distinct from me then
    raise exception 'Only the Tool Drive of this call (or an admin) can edit it' using errcode = '42501';
  end if;
  if not adm and (f ? 'candidate' or f ? 'client' or f ? 'toolDriveMemberId' or f ? 'support1' or f ? 'support2') then
    raise exception 'Only an admin can change the candidate, client, Tool Drive or Call Support' using errcode = '42501';
  end if;

  v_date   := case when f ? 'date' then nullif(f->>'date', '')::date else i.interview_date end;
  v_time   := case when f ? 'time' then nullif(f->>'time', '')::time else i.interview_time end;
  v_dur    := case when f ? 'duration' then nullif(regexp_replace(coalesce(f->>'duration', ''), '\D', '', 'g'), '')::int else i.duration_minutes end;
  v_round  := case when f ? 'round' then public.cp_clean(f->>'round') else i.round end;
  v_type   := case when f ? 'type' then public.cp_clean(f->>'type') else i.interview_type end;
  v_role   := case when f ? 'role' then public.cp_clean(f->>'role') else i.role end;
  v_status := case when f ? 'status' then public.cp_clean(f->>'status') else i.interview_status end;
  v_notes  := case when f ? 'notes' then public.cp_clean(f->>'notes') else i.notes end;
  v_fb     := case when f ? 'feedback' then nullif(btrim(coalesce(f->>'feedback', '')), '') else i.feedback end;
  v_cand   := i.candidate_id; v_client := i.client_id; v_td := i.tool_drive_member_id; v_tdname := i.tool_drive;
  v_s1     := case when f ? 'support1' then nullif(f->>'support1', '')::bigint else i.call_support_1 end;
  v_s2     := case when f ? 'support2' then nullif(f->>'support2', '')::bigint else i.call_support_2 end;

  if v_round is null or v_round !~ '^(Round [1-9][0-9]?|Final|Loop)$' then raise exception 'Round must be Round 1, Round 2 ... Final or Loop'; end if;
  if v_type is null or not (v_type = any(types)) then raise exception 'Unknown interview type %', coalesce(v_type, ''); end if;
  if v_dur is null or v_dur < 5 or v_dur > 600 then raise exception 'Duration must be between 5 and 600 minutes'; end if;
  if v_status is distinct from i.interview_status and v_status not in ('Scheduled','Completed','Cancelled','Date Pending') then
    raise exception 'Status must be Scheduled, Completed, Cancelled or Date Pending';
  end if;
  if (v_date is null or v_time is null) and v_status not in ('Date Pending','Cancelled','Rescheduled') then
    raise exception 'Give the date and time, or set the status to Date Pending';
  end if;
  if not adm and v_status = 'Completed' and v_status is distinct from i.interview_status
     and (v_date is null or v_date > public.cp_list_today()) then
    raise exception 'A call in the future cannot be marked Completed';
  end if;

  if adm and f ? 'candidate' then
    nm := public.cp_clean(f->>'candidate');
    if nm is null then raise exception 'Candidate name is missing'; end if;
    select id into v_cand from candidates where public.name_key(name) = public.name_key(nm) order by id limit 1;
    if v_cand is null then
      insert into candidates (name) values (nm) returning id into v_cand;
      changed := changed || ('new candidate ' || nm);
    end if;
  end if;
  if adm and f ? 'client' then
    nm := public.cp_clean(f->>'client');
    if nm is null then raise exception 'Client name is missing'; end if;
    select id into v_client from clients
     where lower(name) = lower(nm) or (public.client_key(name) <> '' and public.client_key(name) = public.client_key(nm))
     order by (lower(name) = lower(nm)) desc, id limit 1;
    if v_client is null then
      insert into clients (name) values (nm) returning id into v_client;
      changed := changed || ('new client ' || nm);
    end if;
  end if;
  if adm and f ? 'toolDriveMemberId' then
    v_td := nullif(f->>'toolDriveMemberId', '')::bigint;
    if v_td is null then v_tdname := null;
    else
      if not public.cp_is_super() and not public.cp_member_assignable(v_td) then
        raise exception 'This person is in the other Call Pilots team' using errcode = '42501';
      end if;
      select name into v_tdname from team_members where id = v_td;
      if v_tdname is null then raise exception 'Tool Drive person not found'; end if;
    end if;
  end if;
  if v_s1 is not null and v_s1 = v_s2 then raise exception 'Call Support 1 and 2 must be different people'; end if;
  if (v_s1 is not null and not exists (select 1 from team_members where id = v_s1))
     or (v_s2 is not null and not exists (select 1 from team_members where id = v_s2)) then
    raise exception 'Call Support person not found';
  end if;

  if v_cand is distinct from i.candidate_id then changed := changed || 'candidate'::text; end if;
  if v_client is distinct from i.client_id then changed := changed || 'client'::text; end if;
  if v_role is distinct from i.role then changed := changed || 'role'::text; end if;
  if v_date is distinct from i.interview_date then changed := changed || 'date'::text; end if;
  if v_time is distinct from i.interview_time then changed := changed || 'time'::text; end if;
  if v_dur is distinct from i.duration_minutes then changed := changed || 'duration'::text; end if;
  if v_round is distinct from i.round then changed := changed || 'round'::text; end if;
  if v_type is distinct from i.interview_type then changed := changed || 'type'::text; end if;
  if v_status is distinct from i.interview_status then changed := changed || ('status ' || v_status); end if;
  if v_td is distinct from i.tool_drive_member_id then changed := changed || 'Tool Drive'::text; end if;
  if v_s1 is distinct from i.call_support_1 or v_s2 is distinct from i.call_support_2 then changed := changed || 'Call Support'::text; end if;
  if v_notes is distinct from i.notes then changed := changed || 'notes'::text; end if;
  if v_fb is distinct from i.feedback then changed := changed || 'feedback'::text; end if;
  if cardinality(changed) = 0 then return jsonb_build_object('ok', true, 'id', p_id, 'changed', '[]'::jsonb); end if;

  begin
    update interviews set
      candidate_id = v_cand, client_id = v_client, role = v_role,
      interview_date = v_date, interview_time = v_time, duration_minutes = v_dur,
      round = v_round, interview_type = v_type, interview_status = v_status,
      tool_drive_member_id = v_td, tool_drive = v_tdname, call_support_1 = v_s1, call_support_2 = v_s2,
      notes = v_notes, feedback = v_fb,
      -- a new date/time or a final status answers a reschedule request
      cp_reschedule_requested_at = case when v_date is distinct from i.interview_date or v_time is distinct from i.interview_time
                                          or v_status in ('Completed','Cancelled') then null else cp_reschedule_requested_at end,
      cp_reschedule_note = case when v_date is distinct from i.interview_date or v_time is distinct from i.interview_time
                                  or v_status in ('Completed','Cancelled') then null else cp_reschedule_note end
     where id = p_id;
  exception when unique_violation then
    raise exception 'The same interview (candidate, client, round, date and time) is already in the portal';
  end;

  insert into activity_log (actor_email, action, entity, entity_id)
  values (public.cp_email(), 'Call Pilots: edited call (' || array_to_string(changed, ', ') || ')', 'interview', p_id::text);
  return jsonb_build_object('ok', true, 'id', p_id, 'changed', to_jsonb(changed));
end $$;

-- Delete a call: admins only, within their teams. Unpaid incentives of the call go with it
-- (TTOP's delete trigger); the activity log keeps what was deleted.
create or replace function public.cp_delete_call(p_id bigint, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i interviews%rowtype; what text;
begin
  perform public.cp_require(true);
  select * into i from interviews where id = p_id for update;
  if not found then raise exception 'Call not found'; end if;
  if not public.cp_call_in_admin_scope(i.tool_drive_member_id) then
    raise exception 'This call belongs to another team' using errcode = '42501';
  end if;
  select format('%s · %s · %s · %s %s · %s', cd.name, cl.name, i.round, coalesce(i.interview_date::text, 'no date'),
                coalesce(to_char(i.interview_time, 'HH24:MI'), ''), i.interview_status)
    into what from candidates cd, clients cl where cd.id = i.candidate_id and cl.id = i.client_id;
  delete from interviews where id = p_id;
  insert into activity_log (actor_email, action, entity, entity_id)
  values (public.cp_email(), 'Call Pilots: deleted call ' || coalesce(what, '') || coalesce(' - ' || left(public.cp_clean(p_reason), 200), ''),
          'interview', p_id::text);
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

-- Calls page: same as 20261126000002, plus Call Support ids and the Tool Drive id for editing,
-- and calls driven by other teams' Tool Drive people are shown to admins.
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
        'support', nullif(concat_ws(', ', s1.name, s2.name), ''), 'support1', i.call_support_1, 'support2', i.call_support_2,
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
                    or td.call_pilot_team is null or not public.cp_is_cp_team(td.call_pilot_team)
              else i.tool_drive_member_id = me or i.call_support_1 = me or i.call_support_2 = me end)) z));
end $$;

do $g$
begin
  revoke all on function public.cp_edit_call(bigint, jsonb), public.cp_delete_call(bigint, text), public.cp_my_calls(bigint) from public, anon;
  grant execute on function public.cp_edit_call(bigint, jsonb), public.cp_delete_call(bigint, text), public.cp_my_calls(bigint) to authenticated;
end $g$;

-- let the API see the new functions straight away
notify pgrst, 'reload schema';
