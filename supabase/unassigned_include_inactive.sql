-- TTOP Portal: show INACTIVE candidates without a Technical POC to all users too
-- (Candidates > Technical POC filter > "Unassigned"). Safe on the live database: only the view changes.
-- Supabase > SQL Editor > paste > Run.
create or replace view public.unassigned_candidates with (security_invoker = false) as
  select c.id, c.name, c.assigned_domains, c.marketing_poc, c.location, c.created_at,
         (select count(*) from interviews i where i.candidate_id = c.id) as interviews,
         (select max(i.interview_date) from interviews i where i.candidate_id = c.id) as last_interview,
         (select string_agg(distinct cl.name, ', ') from interviews i join clients cl on cl.id = i.client_id where i.candidate_id = c.id) as clients,
         c.active
  from candidates c
  where c.technical_poc_id is null and public.is_approved();
revoke all on public.unassigned_candidates from anon;
grant select on public.unassigned_candidates to authenticated;

-- Check: everyone without a Technical POC
select name, active from public.candidates where technical_poc_id is null order by active desc, name;
