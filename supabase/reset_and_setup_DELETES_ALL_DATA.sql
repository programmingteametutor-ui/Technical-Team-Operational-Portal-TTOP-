-- =====================================================================
-- TTOP PORTAL: COMPLETE DATABASE SETUP (single file)
-- Includes everything: schema, roles/RLS, incentive rules, closers (marks interviews Placed),
-- Import Review, duplicate protection (name order / email / phone / client variants),
-- Tool Drive visibility, security hardening and function lockdown.
-- Rebuilds the portal tables from scratch (Google logins in auth.users are kept).
-- =====================================================================
-- SAFETY GUARD: this script DELETES ALL PORTAL DATA. To run it, uncomment the next line, then run.
-- set app.allow_reset = 'yes';
do $$ begin if current_setting('app.allow_reset', true) is distinct from 'yes' then
  raise exception 'Reset blocked: uncomment the "set app.allow_reset" line at the top to confirm.'; end if; end $$;

-- =====================================================================
-- TTOP Portal: FULL RESET + SETUP (one script, run it once, top to bottom)
-- WARNING: deletes all portal data. Google logins (auth.users) are kept.
-- Part 1 clears, Part 2 creates tables/policies/functions, Part 3 adds admin, team and profiles.
-- =====================================================================

-- ---------- PART 1: CLEAR EVERYTHING ----------
drop trigger if exists on_auth_user_created on auth.users;
drop view if exists public.interview_records_all;

drop table if exists public.activity_log, public.incentives, public.interviews,
  public.assessments, public.candidates, public.clients, public.team_members,
  public.profiles, public.admin_emails, public.closers, public.import_review cascade;

drop function if exists public.generate_incentives(bigint), public.trg_interview_incentives(),
  public.resolve_recipient(), public.handle_new_user(), public.touch_updated_at(),
  public.owns_candidate(bigint), public.my_member_id(), public.is_approved(), public.is_admin() cascade;

-- ---------- PART 2: CREATE TABLES, FUNCTIONS, POLICIES ----------
-- =====================================================================
-- TTOP Portal: Supabase (PostgreSQL) schema
-- Run in the Supabase SQL editor (or `supabase db push`) on a TEST project first.
-- Before using: Auth > Providers > enable Google. Put your admin emails in
-- admin_emails (bottom of this file) BEFORE the first admin signs in.
-- =====================================================================

create extension if not exists pg_trgm;

-- ---------- Access control tables ----------
create table public.admin_emails (email text primary key);          -- admin allow-list

create table public.profiles (                                      -- one row per signed-in Google user
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text,
  role text not null default 'user' check (role in ('admin','user')),
  approved boolean not null default false,                          -- new users wait for admin approval
  created_at timestamptz not null default now()
);

-- ---------- Reference data ----------
create table public.team_members (
  id bigint generated always as identity primary key,
  name text not null,
  email text not null unique,                                       -- matched to the login email
  is_technical_poc boolean not null default false,
  is_tool_drive boolean not null default false,
  is_call_support boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.clients (
  id bigint generated always as identity primary key,
  name text not null
);
create unique index clients_name_ci on public.clients (lower(name));

-- ---------- Candidates (no role/client here: they belong to each interview) ----------
create table public.candidates (
  id bigint generated always as identity primary key,
  name text not null,
  email text, phone text, location text, experience text,
  assigned_domains text,
  technical_poc_id bigint references public.team_members(id),       -- set once, shown on every interview
  marketing_poc text,
  active boolean not null default true,
  assigned_user_id uuid references public.profiles(id),
  drive_folder_url text,                                            -- one Drive folder per candidate
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index candidates_name_trgm on public.candidates using gin (name gin_trgm_ops);  -- fast search
create index candidates_poc on public.candidates (technical_poc_id);

-- ---------- Assessments ----------
create table public.assessments (
  id bigint generated always as identity primary key,
  candidate_id bigint not null references public.candidates(id) on delete cascade,
  type text not null,
  tech_role text not null,
  client_id bigint references public.clients(id),
  status text not null default 'Pending' check (status in ('Pending','In Progress','Completed')),
  assessment_date date not null default current_date,
  files jsonb not null default '[]',                                -- [{name, drive_url}]
  drive_folder_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index assessments_candidate on public.assessments (candidate_id);

-- ---------- Interviews ----------
create table public.interviews (
  id bigint generated always as identity primary key,
  candidate_id bigint not null references public.candidates(id) on delete cascade,
  role text,                                                        -- per interview, not per candidate
  client_id bigint not null references public.clients(id),
  interview_date date not null,                                     -- the day's list (a 1:30 AM call stays on that list)
  interview_time time not null,
  duration_minutes int not null default 60,
  round text not null check (round ~ '^(Round [1-9][0-9]?|Final)$'),
  round_rank int generated always as (
    case when round = 'Final' then 99 else regexp_replace(round, '\D', '', 'g')::int end) stored,
  -- business-day order: times before 06:00 sort after the evening calls of the same list day
  sort_key timestamp generated always as (
    (interview_date + interview_time) +
    case when interview_time < time '06:00' then interval '1 day' else interval '0' end) stored,
  interview_type text not null default 'Technical' check (interview_type in
    ('Recruiter','Technical','Hiring Manager','Leadership','Director','Coding',
     'System Design','Assessment','Presentation','Cultural Fit','Onsite')),
  source text not null default 'Direct' check (source in ('Assessment Based','Direct')),
  assessment_id bigint references public.assessments(id),
  interviewer text,
  tool_drive text,                                                  -- free text (suggestions come from the team)
  call_support_1 bigint references public.team_members(id) on delete set null,
  call_support_2 bigint references public.team_members(id) on delete set null,
  prep_status text not null default 'Pending' check (prep_status in ('Pending','In Progress','Done')),
  prep_date date, prepared_by text, prep_notes text, notes text, feedback text,
  interview_status text not null default 'Scheduled'
    check (interview_status in ('Scheduled','Completed','Cancelled','Rescheduled')),
  placement_status text check (placement_status in ('Placed','Rejected','On Hold')),
  rescheduled_from bigint references public.interviews(id) on delete set null,         -- original stays as 'Rescheduled'
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assessment_link check (source = 'Direct' or assessment_id is not null),
  constraint call_support_differs check (call_support_1 is null or call_support_1 <> call_support_2)
);
create index interviews_date on public.interviews (interview_date);
create index interviews_sort on public.interviews (sort_key);
create index interviews_candidate on public.interviews (candidate_id, client_id);
create index interviews_dupe on public.interviews (candidate_id, client_id, interview_date, interview_time, round);

-- ---------- Incentives (written only by the database function below) ----------
create table public.incentives (
  id bigint generated always as identity primary key,
  candidate_id bigint not null references public.candidates(id) on delete cascade,
  client_id bigint not null references public.clients(id),
  interview_id bigint references public.interviews(id) on delete set null,
  round_label text not null,                                        -- e.g. 'Round 1 → Round 2' or 'Final'
  incentive_type text not null,
  recipient_name text not null default '',                          -- may be filled in later
  recipient_member_id bigint references public.team_members(id) on delete set null,
  amount numeric(10,2) not null,
  status text not null default 'Pending' check (status in ('Pending','Paid')),
  event_date date not null default current_date,
  created_at timestamptz not null default now(),
  constraint incentive_once unique (candidate_id, client_id, round_label, incentive_type)  -- duplicate protection
);

create table public.activity_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_email text, actor_name text,
  action text not null, entity text, entity_id text
);

-- ---------- Helper functions ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin' and approved) $$;

create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = (select auth.uid()) and approved) $$;

-- Team row of the signed-in user (matched by login email)
create or replace function public.my_member_id() returns bigint
language sql stable security definer set search_path = public as $$
  select tm.id from team_members tm join profiles p on lower(p.email) = lower(tm.email)
  where p.id = (select auth.uid()) and p.approved limit 1 $$;

-- A candidate is "mine" only when I am their Technical POC
create or replace function public.owns_candidate(cid bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from candidates c where c.id = cid and c.technical_poc_id = public.my_member_id()) $$;

-- ---------- Triggers ----------
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger t_cand_upd before update on public.candidates for each row execute function public.touch_updated_at();
create trigger t_assess_upd before update on public.assessments for each row execute function public.touch_updated_at();
create trigger t_int_upd before update on public.interviews for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare adm boolean;
begin
  adm := exists (select 1 from admin_emails a where lower(a.email) = lower(new.email));
  insert into profiles (id, email, name, role, approved)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email),
          case when adm then 'admin' else 'user' end, adm);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Link an incentive recipient (free text) to a team member when the name matches
create or replace function public.resolve_recipient() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.recipient_member_id := (select id from team_members
    where lower(name) = lower(new.recipient_name)
       or lower(split_part(name, ' ', 1)) = lower(new.recipient_name) limit 1);
  return new;
end $$;
create trigger t_inc_resolve before insert or update of recipient_name on public.incentives
  for each row execute function public.resolve_recipient();

-- ---------- Incentive rules ----------
-- First interview with a client: 0. Progression pays the PREVIOUS round's Tool Drive:
-- Round 1 -> 2 = 100, later rounds = 500. Final + Placed = 2000 Tool Drive + 2000 Candidate POC,
-- or 4000 once when both are the same person (compared by first name).
create or replace function public.generate_incentives(p_interview bigint) returns void
language plpgsql security definer set search_path = public as $$
declare i interviews%rowtype; p interviews%rowtype; poc_name text;
begin
  select * into i from interviews where id = p_interview;
  if not found or i.interview_status = 'Cancelled' then return; end if;
  select tm.name into poc_name from candidates c
    join team_members tm on tm.id = c.technical_poc_id where c.id = i.candidate_id;

  select * into p from interviews x
   where x.candidate_id = i.candidate_id and x.client_id = i.client_id and x.id <> i.id
     and x.interview_status <> 'Cancelled' and x.round_rank < i.round_rank
   order by x.round_rank desc, x.sort_key desc limit 1;

  if found then
    insert into incentives (candidate_id, client_id, interview_id, round_label, incentive_type, recipient_name, amount, event_date)
    values (i.candidate_id, i.client_id, i.id, p.round || ' → ' || i.round,
            'Round progression (previous Tool Drive)', coalesce(p.tool_drive, ''),
            case when i.round_rank = 2 then 100 else 500 end, i.interview_date)
    on conflict (candidate_id, client_id, round_label, incentive_type)
    do update set recipient_name = excluded.recipient_name
       where incentives.recipient_name = '' and excluded.recipient_name <> '';
  end if;

  if i.round = 'Final' and i.placement_status = 'Placed' then
    if coalesce(i.tool_drive, '') <> '' and poc_name is not null
       and lower(split_part(i.tool_drive, ' ', 1)) = lower(split_part(poc_name, ' ', 1)) then
      insert into incentives (candidate_id, client_id, interview_id, round_label, incentive_type, recipient_name, amount, event_date)
      values (i.candidate_id, i.client_id, i.id, 'Final', 'Final + Placed (Tool Drive & Candidate POC)', i.tool_drive, 4000, i.interview_date)
      on conflict do nothing;
    else
      insert into incentives (candidate_id, client_id, interview_id, round_label, incentive_type, recipient_name, amount, event_date)
      values (i.candidate_id, i.client_id, i.id, 'Final', 'Final + Placed (Tool Drive)', coalesce(i.tool_drive, ''), 2000, i.interview_date)
      on conflict (candidate_id, client_id, round_label, incentive_type)
      do update set recipient_name = excluded.recipient_name
         where incentives.recipient_name = '' and excluded.recipient_name <> '';
      insert into incentives (candidate_id, client_id, interview_id, round_label, incentive_type, recipient_name, amount, event_date)
      values (i.candidate_id, i.client_id, i.id, 'Final', 'Final + Placed (Candidate POC)', coalesce(poc_name, ''), 2000, i.interview_date)
      on conflict do nothing;
    end if;
  end if;
end $$;

-- Runs on every new or updated interview. Later rounds are re-checked so a late-assigned
-- Tool Drive name fills the blank recipient instead of creating a second incentive.
create or replace function public.trg_interview_incentives() returns trigger
language plpgsql security definer set search_path = public as $$
declare r bigint;
begin
  perform generate_incentives(new.id);
  for r in select id from interviews
           where candidate_id = new.candidate_id and client_id = new.client_id and id <> new.id loop
    perform generate_incentives(r);
  end loop;
  return new;
end $$;
create trigger t_int_incentives after insert or update on public.interviews
  for each row execute function public.trg_interview_incentives();

-- ---------- Row Level Security ----------
alter table public.admin_emails  enable row level security;   -- no policies: nobody reads it from the browser
alter table public.profiles      enable row level security;
alter table public.team_members  enable row level security;
alter table public.clients       enable row level security;
alter table public.candidates    enable row level security;
alter table public.assessments   enable row level security;
alter table public.interviews    enable row level security;
alter table public.incentives    enable row level security;
alter table public.activity_log  enable row level security;

revoke all on all tables in schema public from anon;           -- signed-out visitors get nothing

-- profiles
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- team and clients: approved users read; admin manages; approved users may add a new client
create policy team_read  on public.team_members for select to authenticated using (public.is_approved());
create policy team_admin on public.team_members for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy clients_read   on public.clients for select to authenticated using (public.is_approved());
create policy clients_add    on public.clients for insert to authenticated with check (public.is_approved());
create policy clients_admin  on public.clients for update to authenticated using (public.is_approved()) with check (public.is_approved());
create policy clients_delete on public.clients for delete to authenticated using (public.is_approved());  -- foreign keys still block deleting a client that is in use

-- candidates: admin sees all; a user sees and creates only their own (they are the Technical POC)
create policy cand_select on public.candidates for select to authenticated
  using (public.is_admin() or technical_poc_id = public.my_member_id());
create policy cand_insert on public.candidates for insert to authenticated
  with check (public.is_admin() or technical_poc_id = public.my_member_id());
create policy cand_update on public.candidates for update to authenticated
  using (public.is_admin() or technical_poc_id = public.my_member_id())
  with check (public.is_admin() or technical_poc_id = public.my_member_id());
create policy cand_delete on public.candidates for delete to authenticated
  using (public.is_admin() or technical_poc_id = public.my_member_id());

-- interviews and assessments follow the candidate's Technical POC
create policy int_select on public.interviews for select to authenticated
  using (public.is_admin() or public.owns_candidate(candidate_id));
create policy int_insert on public.interviews for insert to authenticated
  with check (public.is_admin() or public.owns_candidate(candidate_id));
create policy int_update on public.interviews for update to authenticated
  using (public.is_admin() or public.owns_candidate(candidate_id))
  with check (public.is_admin() or public.owns_candidate(candidate_id));
create policy int_delete on public.interviews for delete to authenticated
  using (public.is_admin() or public.owns_candidate(candidate_id));

create policy ass_select on public.assessments for select to authenticated
  using (public.is_admin() or public.owns_candidate(candidate_id));
create policy ass_insert on public.assessments for insert to authenticated
  with check (public.is_admin() or public.owns_candidate(candidate_id));
create policy ass_update on public.assessments for update to authenticated
  using (public.is_admin() or public.owns_candidate(candidate_id))
  with check (public.is_admin() or public.owns_candidate(candidate_id));
create policy ass_delete on public.assessments for delete to authenticated using (public.is_admin());

-- incentives: read-only from the browser; a user sees only rows where they are the recipient
create policy inc_select on public.incentives for select to authenticated
  using (public.is_admin() or recipient_member_id = public.my_member_id());
create policy inc_admin_update on public.incentives for update to authenticated
  using (public.is_admin()) with check (public.is_admin());   -- e.g. mark Paid

-- activity log: admin reads; approved users append their own entries
create policy log_read   on public.activity_log for select to authenticated using (public.is_admin());
create policy log_insert on public.activity_log for insert to authenticated
  with check (public.is_approved() and actor_email = (select auth.jwt() ->> 'email'));

-- ---------- "All Interview Records" for every user ----------
-- Only the columns shown in that table, for every approved user (Technical POC filter works for all).
-- The view runs with the owner's rights, so it bypasses the row policy above, but it exposes nothing else.
create or replace view public.interview_records_all with (security_invoker = false) as
  select i.id, c.name as candidate, i.role, cl.name as client, i.interview_date, i.interview_time,
         i.duration_minutes, i.round, tm.name as technical_poc, i.interview_type,
         i.interview_status, i.sort_key, public.owns_candidate(i.candidate_id) as is_mine, i.prep_status
  from interviews i
  join candidates c on c.id = i.candidate_id
  join clients cl on cl.id = i.client_id
  left join team_members tm on tm.id = c.technical_poc_id
  where public.is_approved();
revoke all on public.interview_records_all from anon;
grant select on public.interview_records_all to authenticated;

-- ---------- First-time setup ----------
-- insert into admin_emails (email) values ('you@yourcompany.com');
-- insert into clients (name) values ('Acme Corp'), ('Globex');
-- insert into team_members (name, email, is_technical_poc, is_tool_drive, is_call_support)
--   values ('Gopi', 'gopi@yourcompany.com', true, false, false);

-- ---------- PART 3: ADMIN, TEAM AND PROFILES ----------
insert into admin_emails (email) values ('programmingteam.etutor@gmail.com');

insert into team_members (name, email, is_technical_poc, is_tool_drive, is_call_support) values
  ('Madhuri',     'madhuuu63055@gmail.com',                false, true, true),
  ('Sai Apparao', 'saidharam6@gmail.com',                  true,  true, true),
  ('Kishore',     'kishorebabu.byella.edubot@gmail.com',   true,  true, true),
  ('Dilip',       'dilipkumar.byella.edubot@gmail.com',    true,  true, true),
  ('Kumar',       'kumaryerraboyina123@gmail.com',         true,  true, true),
  ('Vamsi',       'vamsi.pattapu07@gmail.com',             true,  true, true),
  ('Pavan',       'pavvimarasu@gmail.com',                 true,  true, true),
  ('Gopi',        'pasupuletigopikrishna830@gmail.com',    true,  true, true),
  ('Karthik',     'karthik.dhaniyala06@gmail.com',         true,  true, true);

-- Rebuild a profile for every Google login that already exists (this fixes
-- "Could not load your profile"). Admins and team members are approved.
insert into profiles (id, email, name, role, approved)
select u.id, u.email, coalesce(u.raw_user_meta_data->>'full_name', u.email),
       case when exists (select 1 from admin_emails a where lower(a.email) = lower(u.email)) then 'admin' else 'user' end,
       exists (select 1 from admin_emails a where lower(a.email) = lower(u.email))
         or exists (select 1 from team_members t where lower(t.email) = lower(u.email))
from auth.users u
on conflict (id) do nothing;

-- Check: should list every login with its role and approval
select email, role, approved from profiles order by email;

-- ---------- PART 4: LOOP ROUNDS + INCENTIVE EDIT/APPROVAL ----------
-- =====================================================================
-- TTOP Portal: Incentive edit + admin approval, and "Loop" rounds (no incentive)
-- Safe to run once on top of the existing schema (Supabase SQL editor).
-- =====================================================================

-- ---------- 1. Loop rounds ----------
do $$ declare c record; begin
  for c in select conname from pg_constraint
           where conrelid = 'public.interviews'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%Final%' loop
    execute format('alter table public.interviews drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.interviews drop column if exists round_rank;
alter table public.interviews add constraint interviews_round_check
  check (round ~ '^(Round [1-9][0-9]?|Final|Loop)$');
alter table public.interviews add column round_rank int generated always as (
  case when round = 'Final' then 99 when round = 'Loop' then 0
       else regexp_replace(round, '\D', '', 'g')::int end) stored;

-- Same rules as before, but a Loop round pays nothing and never counts as the "previous round".
create or replace function public.generate_incentives(p_interview bigint) returns void
language plpgsql security definer set search_path = public as $$
declare i interviews%rowtype; p interviews%rowtype; poc_name text;
begin
  select * into i from interviews where id = p_interview;
  if not found or i.interview_status = 'Cancelled' or i.round = 'Loop' then return; end if;
  select tm.name into poc_name from candidates c
    join team_members tm on tm.id = c.technical_poc_id where c.id = i.candidate_id;

  select * into p from interviews x
   where x.candidate_id = i.candidate_id and x.client_id = i.client_id and x.id <> i.id
     and x.interview_status <> 'Cancelled' and x.round <> 'Loop' and x.round_rank < i.round_rank
   order by x.round_rank desc, x.sort_key desc limit 1;

  if found then
    insert into incentives (candidate_id, client_id, interview_id, round_label, incentive_type, recipient_name, amount, event_date)
    values (i.candidate_id, i.client_id, i.id, p.round || ' → ' || i.round,
            'Round progression (previous Tool Drive)', coalesce(p.tool_drive, ''),
            case when i.round_rank = 2 then 100 else 500 end, i.interview_date)
    on conflict (candidate_id, client_id, round_label, incentive_type)
    do update set recipient_name = excluded.recipient_name
       where incentives.recipient_name = '' and excluded.recipient_name <> '';
  end if;

  if i.round = 'Final' and i.placement_status = 'Placed' then
    if coalesce(i.tool_drive, '') <> '' and poc_name is not null
       and lower(split_part(i.tool_drive, ' ', 1)) = lower(split_part(poc_name, ' ', 1)) then
      insert into incentives (candidate_id, client_id, interview_id, round_label, incentive_type, recipient_name, amount, event_date)
      values (i.candidate_id, i.client_id, i.id, 'Final', 'Final + Placed (Tool Drive & Candidate POC)', i.tool_drive, 4000, i.interview_date)
      on conflict do nothing;
    else
      insert into incentives (candidate_id, client_id, interview_id, round_label, incentive_type, recipient_name, amount, event_date)
      values (i.candidate_id, i.client_id, i.id, 'Final', 'Final + Placed (Tool Drive)', coalesce(i.tool_drive, ''), 2000, i.interview_date)
      on conflict (candidate_id, client_id, round_label, incentive_type)
      do update set recipient_name = excluded.recipient_name
         where incentives.recipient_name = '' and excluded.recipient_name <> '';
      insert into incentives (candidate_id, client_id, interview_id, round_label, incentive_type, recipient_name, amount, event_date)
      values (i.candidate_id, i.client_id, i.id, 'Final', 'Final + Placed (Candidate POC)', coalesce(poc_name, ''), 2000, i.interview_date)
      on conflict do nothing;
    end if;
  end if;
end $$;

-- ---------- 2. Incentive edits that need admin approval ----------
alter table public.incentives
  add column if not exists approval_status text not null default 'Approved'
    check (approval_status in ('Approved','Pending Approval','Rejected')),
  add column if not exists proposed_amount numeric(10,2),
  add column if not exists proposed_recipient text,
  add column if not exists edit_note text,
  add column if not exists proposed_by text,
  add column if not exists reviewed_by text,
  add column if not exists reviewed_at timestamptz;

-- Anyone who can see an incentive (its recipient) proposes a change; an admin's own edit is applied at once.
create or replace function public.propose_incentive_edit(p_id bigint, p_amount numeric, p_recipient text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare r incentives%rowtype; who text := (select auth.jwt() ->> 'email'); rec text := nullif(trim(coalesce(p_recipient, '')), '');
begin
  if p_amount is null or p_amount < 0 then raise exception 'Invalid amount'; end if;
  select * into r from incentives where id = p_id;
  if not found then raise exception 'Incentive not found'; end if;
  if public.is_admin() then
    update incentives set amount = p_amount, recipient_name = coalesce(rec, recipient_name),
      edit_note = nullif(trim(coalesce(p_note, '')), ''), approval_status = 'Approved',
      proposed_amount = null, proposed_recipient = null, proposed_by = null,
      reviewed_by = who, reviewed_at = now()
    where id = p_id;
  elsif public.is_approved() and r.recipient_member_id is not null and r.recipient_member_id = public.my_member_id() then
    if r.status = 'Paid' then raise exception 'Paid incentives can only be changed by an admin'; end if;
    update incentives set proposed_amount = p_amount, proposed_recipient = rec,
      edit_note = nullif(trim(coalesce(p_note, '')), ''), approval_status = 'Pending Approval', proposed_by = who
    where id = p_id;
  else
    raise exception 'Not allowed';
  end if;
end $$;

create or replace function public.review_incentive(p_id bigint, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare r incentives%rowtype; who text := (select auth.jwt() ->> 'email');
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select * into r from incentives where id = p_id;
  if not found or r.approval_status <> 'Pending Approval' then raise exception 'Nothing to review'; end if;
  if p_approve then
    update incentives set amount = coalesce(proposed_amount, amount),
      recipient_name = coalesce(proposed_recipient, recipient_name), approval_status = 'Approved',
      proposed_amount = null, proposed_recipient = null, proposed_by = null, reviewed_by = who, reviewed_at = now()
    where id = p_id;
  else
    update incentives set approval_status = 'Rejected', proposed_amount = null, proposed_recipient = null,
      reviewed_by = who, reviewed_at = now()
    where id = p_id;
  end if;
end $$;

revoke all on function public.propose_incentive_edit(bigint, numeric, text, text) from public, anon;
revoke all on function public.review_incentive(bigint, boolean) from public, anon;
grant execute on function public.propose_incentive_edit(bigint, numeric, text, text) to authenticated;
grant execute on function public.review_incentive(bigint, boolean) to authenticated;

-- ---------- PART 5: RESCHEDULE WITH NO DATE YET (Date Pending) ----------
-- =====================================================================
-- TTOP Portal: reschedule with no date yet ("Date Pending")
-- Safe to run once on top of the existing schema (Supabase SQL editor).
-- =====================================================================

-- The view depends on sort_key, so drop it first and recreate it at the end.
drop view if exists public.interview_records_all;

-- 1. Date and time may be empty while an interview waits for a new slot.
alter table public.interviews drop column if exists sort_key;
alter table public.interviews alter column interview_date drop not null;
alter table public.interviews alter column interview_time drop not null;
alter table public.interviews add column sort_key timestamp generated always as (
  (interview_date + interview_time) +
  case when interview_time < time '06:00' then interval '1 day' else interval '0' end) stored;
create index if not exists interviews_sort on public.interviews (sort_key);

-- 2. New status 'Date Pending'.
do $$ declare c record; begin
  for c in select conname from pg_constraint
           where conrelid = 'public.interviews'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%Rescheduled%' loop
    execute format('alter table public.interviews drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.interviews add constraint interviews_status_check
  check (interview_status in ('Scheduled','Completed','Cancelled','Rescheduled','Date Pending'));

-- 3. Only Date Pending, Cancelled or Rescheduled interviews may have no date/time
--    (a Date Pending interview that gets rescheduled keeps its blank date/time).
alter table public.interviews drop constraint if exists interviews_date_required;
alter table public.interviews add constraint interviews_date_required
  check ((interview_date is not null and interview_time is not null)
         or interview_status in ('Date Pending','Cancelled','Rescheduled'));

-- 4. "All Interview Records" view (unchanged definition).
create or replace view public.interview_records_all with (security_invoker = false) as
  select i.id, c.name as candidate, i.role, cl.name as client, i.interview_date, i.interview_time,
         i.duration_minutes, i.round, tm.name as technical_poc, i.interview_type,
         i.interview_status, i.sort_key, public.owns_candidate(i.candidate_id) as is_mine, i.prep_status
  from interviews i
  join candidates c on c.id = i.candidate_id
  join clients cl on cl.id = i.client_id
  left join team_members tm on tm.id = c.technical_poc_id
  where public.is_approved();
revoke all on public.interview_records_all from anon;
grant select on public.interview_records_all to authenticated;

-- 5. No incentives for an interview without a date, and an undated interview is never
--    the "previous round". When a date is set, the update trigger generates them as usual.
create or replace function public.generate_incentives(p_interview bigint) returns void
language plpgsql security definer set search_path = public as $$
declare i interviews%rowtype; p interviews%rowtype; poc_name text;
begin
  select * into i from interviews where id = p_interview;
  if not found or i.interview_status in ('Cancelled','Date Pending') or i.round = 'Loop'
     or i.interview_date is null then return; end if;
  select tm.name into poc_name from candidates c
    join team_members tm on tm.id = c.technical_poc_id where c.id = i.candidate_id;

  select * into p from interviews x
   where x.candidate_id = i.candidate_id and x.client_id = i.client_id and x.id <> i.id
     and x.interview_status not in ('Cancelled','Date Pending') and x.interview_date is not null
     and x.round <> 'Loop' and x.round_rank < i.round_rank
   order by x.round_rank desc, x.sort_key desc limit 1;

  if found then
    insert into incentives (candidate_id, client_id, interview_id, round_label, incentive_type, recipient_name, amount, event_date)
    values (i.candidate_id, i.client_id, i.id, p.round || ' → ' || i.round,
            'Round progression (previous Tool Drive)', coalesce(p.tool_drive, ''),
            case when i.round_rank = 2 then 100 else 500 end, i.interview_date)
    on conflict (candidate_id, client_id, round_label, incentive_type)
    do update set recipient_name = excluded.recipient_name
       where incentives.recipient_name = '' and excluded.recipient_name <> '';
  end if;

  if i.round = 'Final' and i.placement_status = 'Placed' then
    if coalesce(i.tool_drive, '') <> '' and poc_name is not null
       and lower(split_part(i.tool_drive, ' ', 1)) = lower(split_part(poc_name, ' ', 1)) then
      insert into incentives (candidate_id, client_id, interview_id, round_label, incentive_type, recipient_name, amount, event_date)
      values (i.candidate_id, i.client_id, i.id, 'Final', 'Final + Placed (Tool Drive & Candidate POC)', i.tool_drive, 4000, i.interview_date)
      on conflict do nothing;
    else
      insert into incentives (candidate_id, client_id, interview_id, round_label, incentive_type, recipient_name, amount, event_date)
      values (i.candidate_id, i.client_id, i.id, 'Final', 'Final + Placed (Tool Drive)', coalesce(i.tool_drive, ''), 2000, i.interview_date)
      on conflict (candidate_id, client_id, round_label, incentive_type)
      do update set recipient_name = excluded.recipient_name
         where incentives.recipient_name = '' and excluded.recipient_name <> '';
      insert into incentives (candidate_id, client_id, interview_id, round_label, incentive_type, recipient_name, amount, event_date)
      values (i.candidate_id, i.client_id, i.id, 'Final', 'Final + Placed (Candidate POC)', coalesce(poc_name, ''), 2000, i.interview_date)
      on conflict do nothing;
    end if;
  end if;
end $$;

-- ---------- PART 6: NO DUPLICATE RECORDS ----------
-- =====================================================================
-- TTOP Portal: no duplicate records, ever
-- 1) merges duplicates that are already in the data (nothing useful is lost: blank fields
--    on the kept record are filled from the duplicate, links are moved across),
-- 2) adds database rules so a duplicate can never be saved again.
-- Run once in the Supabase SQL editor. Review first with these (optional):
--   select lower(btrim(name)), count(*) from candidates group by 1 having count(*) > 1;
--   select candidate_id, client_id, round, interview_date, interview_time, count(*) from interviews
--     where interview_status not in ('Rescheduled','Cancelled','Date Pending')
--     group by 1,2,3,4,5 having count(*) > 1;
-- =====================================================================

-- ---------- helper: merge interview "d" into interview "k" ----------
create or replace function public._merge_interview(k bigint, d bigint) returns void
language plpgsql as $$
begin
  update interviews a set
    role            = coalesce(nullif(a.role, ''), x.role),
    interviewer     = coalesce(nullif(a.interviewer, ''), x.interviewer),
    tool_drive      = coalesce(nullif(a.tool_drive, ''), x.tool_drive),
    call_support_1  = coalesce(a.call_support_1, x.call_support_1),
    call_support_2  = case when coalesce(a.call_support_1, x.call_support_1) = coalesce(a.call_support_2, x.call_support_2)
                           then null else coalesce(a.call_support_2, x.call_support_2) end,
    notes           = coalesce(nullif(a.notes, ''), x.notes),
    feedback        = coalesce(nullif(a.feedback, ''), x.feedback),
    prep_notes      = coalesce(nullif(a.prep_notes, ''), x.prep_notes),
    prepared_by     = coalesce(nullif(a.prepared_by, ''), x.prepared_by),
    prep_date       = coalesce(a.prep_date, x.prep_date),
    assessment_id   = coalesce(a.assessment_id, x.assessment_id),
    placement_status= coalesce(a.placement_status, x.placement_status),
    prep_status     = case when 'Done' in (a.prep_status, x.prep_status) then 'Done'
                           when 'In Progress' in (a.prep_status, x.prep_status) then 'In Progress' else a.prep_status end,
    interview_status= case when 'Completed' in (a.interview_status, x.interview_status) then 'Completed' else a.interview_status end
  from interviews x where a.id = k and x.id = d;
  update incentives  set interview_id = k     where interview_id = d;
  update interviews  set rescheduled_from = k where rescheduled_from = d;
  delete from interviews where id = d;
end $$;

-- ---------- 1. Duplicate candidates (same name, ignoring case and extra spaces) ----------
do $$
declare g record; keep bigint; d bigint;
begin
  for g in select min(id) as keep_id, array_agg(id order by id) as ids
           from candidates group by lower(btrim(name)) having count(*) > 1 loop
    keep := g.keep_id;
    foreach d in array g.ids loop
      continue when d = keep;
      update candidates k set
        email = coalesce(nullif(k.email, ''), x.email), phone = coalesce(nullif(k.phone, ''), x.phone),
        location = coalesce(nullif(k.location, ''), x.location), experience = coalesce(nullif(k.experience, ''), x.experience),
        assigned_domains = coalesce(nullif(k.assigned_domains, ''), x.assigned_domains),
        marketing_poc = coalesce(nullif(k.marketing_poc, ''), x.marketing_poc),
        technical_poc_id = coalesce(k.technical_poc_id, x.technical_poc_id),
        assigned_user_id = coalesce(k.assigned_user_id, x.assigned_user_id),
        drive_folder_url = coalesce(k.drive_folder_url, x.drive_folder_url)
      from candidates x where k.id = keep and x.id = d;
      -- incentives that the kept candidate already has would clash, so drop the copies
      delete from incentives i using incentives j
        where i.candidate_id = d and j.candidate_id = keep and i.client_id = j.client_id
          and i.round_label = j.round_label and i.incentive_type = j.incentive_type;
      update incentives  set candidate_id = keep where candidate_id = d;
      update assessments set candidate_id = keep where candidate_id = d;
      update interviews  set candidate_id = keep where candidate_id = d;
      delete from candidates where id = d;
    end loop;
  end loop;
end $$;

-- ---------- 2. Duplicate interviews (same candidate, client, round, date and time) ----------
do $$
declare g record; d bigint;
begin
  for g in select min(id) as keep_id, array_agg(id order by id) as ids from interviews
           where interview_status not in ('Rescheduled','Cancelled','Date Pending')
           group by candidate_id, client_id, round, interview_date, interview_time having count(*) > 1 loop
    foreach d in array g.ids loop
      continue when d = g.keep_id;
      perform public._merge_interview(g.keep_id, d);
    end loop;
  end loop;
  -- more than one "Date Pending" for the same candidate, client and round
  for g in select min(id) as keep_id, array_agg(id order by id) as ids from interviews
           where interview_status = 'Date Pending'
           group by candidate_id, client_id, round having count(*) > 1 loop
    foreach d in array g.ids loop
      continue when d = g.keep_id;
      perform public._merge_interview(g.keep_id, d);
    end loop;
  end loop;
end $$;

-- ---------- 3. Duplicate assessments ----------
do $$
declare g record; d bigint;
begin
  for g in select min(id) as keep_id, array_agg(id order by id) as ids from assessments
           group by candidate_id, lower(btrim(type)), lower(btrim(tech_role)), coalesce(client_id, 0), assessment_date
           having count(*) > 1 loop
    foreach d in array g.ids loop
      continue when d = g.keep_id;
      update assessments a set
        files = (select coalesce(jsonb_agg(distinct e), '[]'::jsonb) from jsonb_array_elements(a.files || x.files) e),
        drive_folder_url = coalesce(a.drive_folder_url, x.drive_folder_url),
        status = case when 'Completed' in (a.status, x.status) then 'Completed'
                      when 'In Progress' in (a.status, x.status) then 'In Progress' else a.status end
      from assessments x where a.id = g.keep_id and x.id = d;
      update interviews set assessment_id = g.keep_id where assessment_id = d;
      delete from assessments where id = d;
    end loop;
  end loop;
end $$;

drop function public._merge_interview(bigint, bigint);

-- ---------- 4. Rules that make duplicates impossible from now on ----------
create unique index if not exists candidates_name_ci on public.candidates (lower(btrim(name)));
create unique index if not exists interviews_no_dupes on public.interviews
  (candidate_id, client_id, round, interview_date, interview_time)
  where interview_status not in ('Rescheduled','Cancelled','Date Pending');
create unique index if not exists interviews_one_pending on public.interviews
  (candidate_id, client_id, round) where interview_status = 'Date Pending';
create unique index if not exists assessments_no_dupes on public.assessments
  (candidate_id, lower(btrim(type)), lower(btrim(tech_role)), coalesce(client_id, 0), assessment_date);
-- clients (clients_name_ci), team members (unique email) and incentives (incentive_once) were already protected.

-- ---------- PART 7: NEW CANDIDATE FIELDS ----------
alter table public.candidates
  add column if not exists date_of_joining date,
  add column if not exists first_client_name text,
  add column if not exists first_client_sector text,
  add column if not exists second_client_name text,
  add column if not exists second_client_sector text,
  add column if not exists visa_type text,
  add column if not exists visa_start_date date,
  add column if not exists visa_end_date date;

alter table public.candidates drop constraint if exists candidates_visa_dates_check;
alter table public.candidates add constraint candidates_visa_dates_check
  check (visa_start_date is null or visa_end_date is null or visa_end_date >= visa_start_date);


-- =====================================================================
-- TTOP Portal: PART 8 - TEAM-ONLY INCENTIVES + MONTH-END CLOSER LIST
-- Run ONCE in the Supabase SQL editor, on top of the existing schema (after Parts 1-7).
-- Safe to re-run.
--  1) Incentives are created only for people in team_members (a Tool Drive from outside
--     the team is skipped; a blank Tool Drive still makes an "Unassigned" row to fill later).
--  2) Final + Placed rules are reconciled so one placement can never pay twice.
--  3) New table + function for the month-end closer list (admin only).
--  4) Existing unpaid incentives for people outside the team are removed.
-- =====================================================================

-- ---------- 1. Is this name one of our team members? (same matching as resolve_recipient) ----------
create or replace function public.is_team_name(n text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(btrim(n), '') <> '' and exists (
    select 1 from team_members
    where lower(name) = lower(btrim(n)) or lower(split_part(name, ' ', 1)) = lower(btrim(n)));
$$;

-- ---------- 2. Closer list (written only by import_closers below) ----------
create table if not exists public.closers (
  id bigint generated always as identity primary key,
  candidate_id bigint not null references public.candidates(id) on delete cascade,
  client_id bigint not null references public.clients(id),
  closer_month date not null,                       -- first day of the list's month
  role text, salary text, tool_drive text,
  created_at timestamptz not null default now(),
  constraint closer_once unique (candidate_id, client_id)
);
alter table public.closers enable row level security;
revoke all on public.closers from anon;
drop policy if exists closers_admin_read on public.closers;
create policy closers_admin_read on public.closers for select to authenticated using (public.is_admin());

-- ---------- 3. Final + Placed incentives (shared by interviews and the closer list) ----------
-- Tool Drive in team + same first name as the Technical POC -> 4000 once.
-- Otherwise 2000 to the Tool Drive (only if in our team) and 2000 to the Technical POC.
-- If any placement incentive for this candidate+client is already Paid, nothing is touched.
-- p_move_date = true (closer list) moves the unpaid incentive into the closer list's month.
create or replace function public._placement_incentives(
  p_cand bigint, p_client bigint, p_td text, p_date date, p_int bigint, p_move_date boolean)
returns void language plpgsql security definer set search_path = public as $$
declare poc_name text; td text := btrim(coalesce(p_td, '')); td_team boolean; same boolean;
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

-- ---------- 4. Interview incentive rules (final version) ----------
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
         where incentives.recipient_name = '' and excluded.recipient_name <> '';
    else
      -- Tool Drive is not in our team: no incentive (drop an empty placeholder if one exists)
      delete from incentives
       where candidate_id = i.candidate_id and client_id = i.client_id and round_label = lbl
         and incentive_type = 'Round progression (previous Tool Drive)'
         and recipient_name = '' and status = 'Pending';
    end if;
  end if;

  if i.round = 'Final' and i.placement_status = 'Placed' then
    perform public._placement_incentives(i.candidate_id, i.client_id, i.tool_drive, i.interview_date, i.id, false);
  end if;
end $$;

-- ---------- 5. Month-end closer list import (admin only) ----------
-- p_rows: [{candidate_id, client_id, role, salary, tool_drive}]  (the page matches the names first)
-- Records the closers and creates the Final + Placed incentives dated on the LAST DAY of p_month,
-- so they fall into that month's payout. If tool_drive is blank it is taken from the candidate's
-- latest interview with that client.
create or replace function public.import_closers(p_month date, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; cid bigint; clid bigint; td text; n int := 0;
        ev date := (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    cid := (r->>'candidate_id')::bigint; clid := (r->>'client_id')::bigint;
    continue when cid is null or clid is null;
    td := nullif(btrim(coalesce(r->>'tool_drive', '')), '');
    if td is null then
      select x.tool_drive into td from interviews x
       where x.candidate_id = cid and x.client_id = clid
         and x.interview_status not in ('Cancelled','Date Pending') and x.round <> 'Loop'
         and coalesce(x.tool_drive, '') <> ''
       order by x.round_rank desc, x.sort_key desc limit 1;
    end if;
    insert into closers (candidate_id, client_id, closer_month, role, salary, tool_drive)
    values (cid, clid, date_trunc('month', p_month)::date, r->>'role', r->>'salary', td)
    on conflict (candidate_id, client_id) do update set
      closer_month = excluded.closer_month, role = excluded.role, salary = excluded.salary, tool_drive = excluded.tool_drive;
    perform public._placement_incentives(cid, clid, td, ev, null, true);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.import_closers(date, jsonb) from public, anon;
grant execute on function public.import_closers(date, jsonb) to authenticated;

-- ---------- 6. Edits: the recipient must be a team member ----------
create or replace function public.propose_incentive_edit(p_id bigint, p_amount numeric, p_recipient text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare r incentives%rowtype; who text := (select auth.jwt() ->> 'email'); rec text := nullif(trim(coalesce(p_recipient, '')), '');
begin
  if p_amount is null or p_amount < 0 then raise exception 'Invalid amount'; end if;
  if rec is not null and not public.is_team_name(rec) then raise exception 'Recipient must be a team member'; end if;
  select * into r from incentives where id = p_id;
  if not found then raise exception 'Incentive not found'; end if;
  if public.is_admin() then
    update incentives set amount = p_amount, recipient_name = coalesce(rec, recipient_name),
      edit_note = nullif(trim(coalesce(p_note, '')), ''), approval_status = 'Approved',
      proposed_amount = null, proposed_recipient = null, proposed_by = null,
      reviewed_by = who, reviewed_at = now()
    where id = p_id;
  elsif public.is_approved() and r.recipient_member_id is not null and r.recipient_member_id = public.my_member_id() then
    if r.status = 'Paid' then raise exception 'Paid incentives can only be changed by an admin'; end if;
    update incentives set proposed_amount = p_amount, proposed_recipient = rec,
      edit_note = nullif(trim(coalesce(p_note, '')), ''), approval_status = 'Pending Approval', proposed_by = who
    where id = p_id;
  else
    raise exception 'Not allowed';
  end if;
end $$;

-- ---------- 7. Clean up: unpaid incentives for people outside the team ----------
-- (recipient_member_id is filled by the resolve_recipient trigger only for team members)
delete from public.incentives
 where recipient_name <> '' and recipient_member_id is null and status <> 'Paid';


 -- =====================================================================
-- TTOP Portal: PART 9 - UNASSIGNED INCENTIVES VISIBLE + EDITABLE BY THE CANDIDATE'S TECHNICAL POC
-- Run ONCE in the Supabase SQL editor, after incentive_update.sql. Safe to re-run.
-- A user now sees (and can propose an edit for) an incentive that has NO recipient yet
-- when they are the Technical POC of that candidate. Their edit still goes to the admin
-- for approval, same as every other user edit.
-- =====================================================================

-- 1. Who can read incentives: admin, the recipient, or (for unassigned rows) the candidate's POC
drop policy if exists inc_select on public.incentives;
create policy inc_select on public.incentives for select to authenticated
  using (public.is_admin()
         or recipient_member_id = public.my_member_id()
         or (recipient_name = '' and public.owns_candidate(candidate_id)));

-- 2. Who can propose an edit
create or replace function public.propose_incentive_edit(p_id bigint, p_amount numeric, p_recipient text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare r incentives%rowtype; who text := (select auth.jwt() ->> 'email'); rec text := nullif(trim(coalesce(p_recipient, '')), '');
begin
  if p_amount is null or p_amount < 0 then raise exception 'Invalid amount'; end if;
  if rec is not null and not public.is_team_name(rec) then raise exception 'Recipient must be a team member'; end if;
  select * into r from incentives where id = p_id;
  if not found then raise exception 'Incentive not found'; end if;
  if public.is_admin() then
    update incentives set amount = p_amount, recipient_name = coalesce(rec, recipient_name),
      edit_note = nullif(trim(coalesce(p_note, '')), ''), approval_status = 'Approved',
      proposed_amount = null, proposed_recipient = null, proposed_by = null,
      reviewed_by = who, reviewed_at = now()
    where id = p_id;
  elsif public.is_approved() and (
          (r.recipient_member_id is not null and r.recipient_member_id = public.my_member_id())
       or (r.recipient_name = '' and public.owns_candidate(r.candidate_id))) then
    if r.status = 'Paid' then raise exception 'Paid incentives can only be changed by an admin'; end if;
    if r.recipient_name = '' and rec is null then raise exception 'Choose who should receive this incentive'; end if;
    update incentives set proposed_amount = p_amount, proposed_recipient = rec,
      edit_note = nullif(trim(coalesce(p_note, '')), ''), approval_status = 'Pending Approval', proposed_by = who
    where id = p_id;
  else
    raise exception 'Not allowed';
  end if;
end $$;

-- =====================================================================
-- TTOP Portal: PART 10 - IMPORT REVIEW PAGE
-- Run ONCE in the Supabase SQL editor (safe to re-run). Keeps all existing data.
-- Rows from the Google Doc import that are not ready (needs candidate, duplicate,
-- needs fixing) are parked here. Every approved user can see them; the app lets
-- the candidate's Technical POC (or an admin) resolve each row.
-- =====================================================================
create table if not exists public.import_review (
  id bigint generated always as identity primary key,
  reason text not null check (reason in ('cand','dupe','fix','ready')),
  payload jsonb not null,                       -- the interview row as it was in the doc
  created_by text,
  created_at timestamptz not null default now()
);

alter table public.import_review enable row level security;

drop policy if exists import_review_read   on public.import_review;
drop policy if exists import_review_insert on public.import_review;
drop policy if exists import_review_update on public.import_review;
drop policy if exists import_review_delete on public.import_review;
create policy import_review_read   on public.import_review for select to authenticated using (public.is_approved());
create policy import_review_insert on public.import_review for insert to authenticated with check (public.is_approved());
create policy import_review_update on public.import_review for update to authenticated using (public.is_approved()) with check (public.is_approved());
create policy import_review_delete on public.import_review for delete to authenticated using (public.is_approved());

-- ---------- FIXES (from fixes.sql) ----------
-- =====================================================================
-- TTOP Portal: FIXES (safe to re-run; keeps all data). Run once in the Supabase SQL editor.
-- Covers: DB cascade protection, incentive cleanup, import_review privacy, auto-approval,
-- deterministic recipient matching, trigger tuning, indexes, input hardening, function lockdown.
-- =====================================================================

-- 1. Never lose payout history when a candidate is deleted (archive with active=false instead)
alter table public.incentives drop constraint if exists incentives_candidate_id_fkey;
alter table public.incentives add constraint incentives_candidate_id_fkey
  foreign key (candidate_id) references public.candidates(id) on delete restrict;
-- safety: remove closer rows left over from an older setup that point at candidates that no longer exist
delete from public.closers where candidate_id not in (select id from public.candidates);
alter table public.closers drop constraint if exists closers_candidate_id_fkey;
alter table public.closers add constraint closers_candidate_id_fkey
  foreign key (candidate_id) references public.candidates(id) on delete restrict;

-- 2. Incentive cleanup: remove unpaid incentives that no longer apply
create or replace function public.trg_interview_incentives() returns trigger
language plpgsql security definer set search_path = public as $$
declare r bigint;
begin
  delete from incentives x
   where x.interview_id = new.id and x.status = 'Pending' and x.approval_status <> 'Pending Approval'
     and ( new.interview_status in ('Cancelled','Date Pending') or new.round = 'Loop' or new.interview_date is null
        or (x.incentive_type like 'Final + Placed%' and not (new.round = 'Final' and new.placement_status = 'Placed'))
        or (x.incentive_type like 'Round progression%' and x.round_label not like ('% → ' || new.round)) );
  perform generate_incentives(new.id);
  for r in select id from interviews
           where candidate_id = new.candidate_id and client_id = new.client_id and id <> new.id loop
    perform generate_incentives(r);
  end loop;
  return new;
end $$;

-- fire only when a relevant column changes (not on note edits)
drop trigger if exists t_int_incentives on public.interviews;
create trigger t_int_incentives
  after insert or update of candidate_id, client_id, round, interview_date, interview_time,
                            interview_status, placement_status, tool_drive
  on public.interviews for each row execute function public.trg_interview_incentives();

create or replace function public.trg_interview_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from incentives where interview_id = old.id and status = 'Pending' and approval_status <> 'Pending Approval';
  return old;
end $$;
drop trigger if exists t_int_deleted on public.interviews;
create trigger t_int_deleted before delete on public.interviews
  for each row execute function public.trg_interview_deleted();

-- Technical POC changed: move the unpaid Candidate-POC incentive to the new POC
create or replace function public.trg_cand_poc_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare n text; r record;
begin
  select name into n from team_members where id = new.technical_poc_id;
  update incentives set recipient_name = coalesce(n, '')
   where candidate_id = new.id and incentive_type = 'Final + Placed (Candidate POC)'
     and status = 'Pending' and approval_status <> 'Pending Approval';
  for r in select id from interviews where candidate_id = new.id and round = 'Final' and placement_status = 'Placed' loop
    perform generate_incentives(r.id);
  end loop;
  return new;
end $$;
drop trigger if exists t_cand_poc on public.candidates;
create trigger t_cand_poc after update of technical_poc_id on public.candidates
  for each row when (old.technical_poc_id is distinct from new.technical_poc_id)
  execute function public.trg_cand_poc_changed();

-- 3. Deterministic recipient matching (exact full name wins) + no two members share a first name
create unique index if not exists team_first_name_uniq on public.team_members (lower(split_part(name, ' ', 1)));
create or replace function public.resolve_recipient() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.recipient_member_id := (select id from team_members
    where lower(name) = lower(new.recipient_name) or lower(split_part(name, ' ', 1)) = lower(new.recipient_name)
    order by (lower(name) = lower(new.recipient_name)) desc, id limit 1);
  return new;
end $$;

-- 4. Team members are approved automatically on first login; names are cleaned
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare adm boolean; tm boolean;
begin
  adm := exists (select 1 from admin_emails a where lower(a.email) = lower(new.email));
  tm  := exists (select 1 from team_members t where lower(t.email) = lower(new.email));
  insert into profiles (id, email, name, role, approved)
  values (new.id, new.email,
          regexp_replace(coalesce(new.raw_user_meta_data->>'full_name', new.email), '[<>"]', '', 'g'),
          case when adm then 'admin' else 'user' end, adm or tm);
  return new;
end $$;
update public.profiles set name = regexp_replace(name, '[<>"]', '', 'g') where name ~ '[<>"]';
update public.profiles p set approved = true
 where not approved and exists (select 1 from team_members t where lower(t.email) = lower(p.email));

-- 5. Import Review: only admin, the candidate's Technical POC, or the importer
alter table public.import_review add column if not exists technical_poc_id bigint references public.team_members(id) on delete set null;
update public.import_review r set technical_poc_id = (select c.technical_poc_id from candidates c
   where lower(btrim(c.name)) = lower(btrim(r.payload->>'cand')) limit 1)
 where r.technical_poc_id is null;

create or replace function public.import_review_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.created_by := coalesce(new.created_by, (select auth.jwt() ->> 'email'));
  if new.technical_poc_id is null then
    new.technical_poc_id := coalesce(
      (select c.technical_poc_id from candidates c where lower(btrim(c.name)) = lower(btrim(new.payload->>'cand')) limit 1),
      public.my_member_id());
  end if;
  return new;
end $$;
drop trigger if exists t_import_review_defaults on public.import_review;
create trigger t_import_review_defaults before insert on public.import_review
  for each row execute function public.import_review_defaults();

drop policy if exists import_review_read on public.import_review;
drop policy if exists import_review_update on public.import_review;
drop policy if exists import_review_delete on public.import_review;
create policy import_review_read on public.import_review for select to authenticated
  using (public.is_admin() or (public.is_approved() and (technical_poc_id = (select public.my_member_id())
         or created_by = (select auth.jwt() ->> 'email'))));
create policy import_review_update on public.import_review for update to authenticated
  using (public.is_admin() or (public.is_approved() and (technical_poc_id = (select public.my_member_id())
         or created_by = (select auth.jwt() ->> 'email'))))
  with check (public.is_approved());
create policy import_review_delete on public.import_review for delete to authenticated
  using (public.is_admin() or (public.is_approved() and (technical_poc_id = (select public.my_member_id())
         or created_by = (select auth.jwt() ->> 'email'))));

-- 6. Activity log: the actor name always comes from the profile, never from the browser
create or replace function public.activity_log_actor() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.actor_name := coalesce((select name from profiles where id = (select auth.uid())), new.actor_email);
  return new;
end $$;
drop trigger if exists t_activity_actor on public.activity_log;
create trigger t_activity_actor before insert on public.activity_log
  for each row execute function public.activity_log_actor();

-- 7. Indexes
create index if not exists incentives_recipient on public.incentives (recipient_member_id, event_date);
create index if not exists incentives_interview on public.incentives (interview_id);

-- 8. Hardening: block HTML characters in free-text fields (existing rows are not re-checked)
do $$ declare t text[]; begin
  foreach t slice 1 in array array[
    ['candidates','name'],['candidates','email'],['candidates','phone'],['candidates','location'],
    ['candidates','marketing_poc'],['candidates','assigned_domains'],['clients','name'],['team_members','name'],
    ['interviews','role'],['interviews','interviewer'],['interviews','tool_drive'],
    ['interviews','notes'],['interviews','feedback'],['interviews','prep_notes']] loop
    execute format('alter table public.%I drop constraint if exists %I', t[1], t[1]||'_'||t[2]||'_nohtml');
    execute format('alter table public.%I add constraint %I check (%I !~ ''[<>]'') not valid', t[1], t[1]||'_'||t[2]||'_nohtml', t[2]);
  end loop;
end $$;

-- 9. OPTIONAL (off by default): enforce "Round 1 is admin-only" in the database.
--    The app reads Round 1 rows for duplicate checks and "next round", so test on staging first.
-- drop policy if exists int_select on public.interviews;
-- create policy int_select on public.interviews for select to authenticated
--   using (public.is_admin() or (public.owns_candidate(candidate_id) and round <> 'Round 1'));

-- 11-pre. Duplicate protection (full version also in duplicate_protection.sql)
-- =====================================================================
-- DUPLICATE PROTECTION (safe to re-run). Run in the Supabase SQL editor.
-- Catches: reordered names, extra spaces/punctuation/titles/accents, same email, same phone,
-- client name variants (Inc/LLC/Ltd). If duplicates already exist, the matching unique index is
-- skipped with a NOTICE; merge them in the app (Interviews > Find duplicates), then run this again.
-- =====================================================================

-- Name key: lower-case, accents/punctuation/titles removed, words SORTED ("Paladugu Harsitha" = "Harsitha Paladugu")
create or replace function public.name_key(t text) returns text language sql immutable parallel safe as $$
  select coalesce(string_agg(w, ' ' order by w collate "C"), '')
  from regexp_split_to_table(
         regexp_replace(
           regexp_replace(translate(lower(coalesce(t,'')), 'áàâäãåéèêëíìîïóòôöõúùûüñç', 'aaaaaaeeeeiiiiooooouuuunc'),
                          '\m(mr|mrs|ms|dr)\M', ' ', 'g'),
           '[^a-z0-9]+', ' ', 'g'), ' ') as w
  where w <> '' $$;

create or replace function public.phone_key(t text) returns text language sql immutable parallel safe as $$
  select case when length(regexp_replace(coalesce(t,''), '\D', '', 'g')) >= 7
              then right(regexp_replace(t, '\D', '', 'g'), 10) end $$;

create or replace function public.client_key(t text) returns text language sql immutable parallel safe as $$
  select regexp_replace(
           regexp_replace(lower(coalesce(t,'')),
             '\m(inc|llc|ltd|limited|corp|corporation|co|company|technologies|technology|tech|group|pvt|plc|the)\M', ' ', 'g'),
           '[^a-z0-9]+', '', 'g') $$;

-- Report of every duplicate group that exists right now:  select * from duplicate_report;
create or replace view public.duplicate_report with (security_invoker = true) as
  select 'candidate name'::text as kind, public.name_key(name) as dup_key, array_agg(id order by id) as ids, array_agg(name order by id) as names
    from public.candidates where public.name_key(name) <> '' group by 2 having count(*) > 1
  union all
  select 'candidate email', lower(btrim(email)), array_agg(id order by id), array_agg(name order by id)
    from public.candidates where coalesce(btrim(email),'') <> '' group by 2 having count(*) > 1
  union all
  select 'candidate phone', public.phone_key(phone), array_agg(id order by id), array_agg(name order by id)
    from public.candidates where public.phone_key(phone) is not null group by 2 having count(*) > 1
  union all
  select 'client', public.client_key(name), array_agg(id order by id), array_agg(name order by id)
    from public.clients where public.client_key(name) <> '' group by 2 having count(*) > 1;

-- Unique indexes (created only when no duplicates exist yet)
do $do$
declare r record; n int;
begin
  for r in select * from (values
    ('candidates_namekey_uniq', 'candidates',   'public.name_key(name)',    $p$public.name_key(name) <> ''$p$),
    ('candidates_email_uniq',   'candidates',   'lower(btrim(email))',      $p$coalesce(btrim(email),'') <> ''$p$),
    ('candidates_phone_uniq',   'candidates',   'public.phone_key(phone)',  $p$public.phone_key(phone) is not null$p$),
    ('clients_key_uniq',        'clients',      'public.client_key(name)',  $p$public.client_key(name) <> ''$p$),
    ('team_namekey_uniq',       'team_members', 'public.name_key(name)',    $p$public.name_key(name) <> ''$p$)
  ) as v(idx, tbl, expr, pred) loop
    execute format('select count(*) from (select 1 from public.%I where %s group by %s having count(*) > 1) d', r.tbl, r.pred, r.expr) into n;
    if n = 0 then
      execute format('create unique index if not exists %I on public.%I (%s) where %s', r.idx, r.tbl, r.expr, r.pred);
    else
      raise notice 'Index % NOT created: % duplicate group(s). Run: select * from duplicate_report;', r.idx, n;
    end if;
  end loop;
end $do$;

-- When a merge moves an interview to another candidate, its incentives follow it
-- (named t_int_a_... so it runs before the incentive trigger)
create or replace function public.trg_interview_moved() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update incentives set candidate_id = new.candidate_id where interview_id = new.id and candidate_id <> new.candidate_id;
  return new;
end $$;
drop trigger if exists t_int_a_moved on public.interviews;
create trigger t_int_a_moved after update of candidate_id on public.interviews
  for each row when (old.candidate_id is distinct from new.candidate_id)
  execute function public.trg_interview_moved();


-- 12. Tool Drive visibility (also in tool_drive_view.sql)
create or replace view public.interview_records_all with (security_invoker = false) as
  select i.id, c.name as candidate, i.role, cl.name as client, i.interview_date, i.interview_time,
         i.duration_minutes, i.round, tm.name as technical_poc, i.interview_type,
         i.interview_status, i.sort_key, public.owns_candidate(i.candidate_id) as is_mine, i.prep_status,
         i.tool_drive
  from interviews i
  join candidates c on c.id = i.candidate_id
  join clients cl on cl.id = i.client_id
  left join team_members tm on tm.id = c.technical_poc_id
  where public.is_approved();
revoke all on public.interview_records_all from anon;
grant select on public.interview_records_all to authenticated;

-- 13. Closer list marks interviews as Placed (also in closers_placed.sql)
create or replace function public.import_closers(p_month date, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; cid bigint; clid bigint; td text; n int := 0; iid bigint;
        ev date := (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    cid := (r->>'candidate_id')::bigint; clid := (r->>'client_id')::bigint;
    continue when cid is null or clid is null;
    td := nullif(btrim(coalesce(r->>'tool_drive', '')), '');
    if td is null then
      select x.tool_drive into td from interviews x
       where x.candidate_id = cid and x.client_id = clid
         and x.interview_status not in ('Cancelled','Date Pending') and x.round <> 'Loop'
         and coalesce(x.tool_drive, '') <> ''
       order by x.round_rank desc, x.sort_key desc limit 1;
    end if;
    insert into closers (candidate_id, client_id, closer_month, role, salary, tool_drive)
    values (cid, clid, date_trunc('month', p_month)::date, r->>'role', r->>'salary', td)
    on conflict (candidate_id, client_id) do update set
      closer_month = excluded.closer_month, role = excluded.role, salary = excluded.salary, tool_drive = excluded.tool_drive;

    -- mark the interview as Placed
    select x.id into iid from interviews x
     where x.candidate_id = cid and x.client_id = clid
       and x.interview_status not in ('Cancelled','Date Pending','Rescheduled') and x.round <> 'Loop'
     order by x.round_rank desc, x.sort_key desc limit 1;
    if iid is not null then
      update interviews set placement_status = 'Placed' where id = iid and placement_status is distinct from 'Placed';
    end if;

    perform public._placement_incentives(cid, clid, td, ev, null, true);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.import_closers(date, jsonb) from public, anon;
grant execute on function public.import_closers(date, jsonb) to authenticated;

-- 14. Find an existing client by the database's own naming rule, or create it (used by the app when saving)
create or replace function public.find_or_create_client(p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.clients%rowtype; v text := btrim(coalesce(p_name, '')); k text := public.client_key(p_name);
begin
  if not public.is_approved() then raise exception 'Not allowed'; end if;
  if v = '' then raise exception 'Client name is required'; end if;
  select * into r from public.clients
   where lower(name) = lower(v) or (k <> '' and public.client_key(name) = k)
   order by (lower(name) = lower(v)) desc, id limit 1;
  if not found then
    begin
      insert into public.clients (name) values (v) returning * into r;
    exception when unique_violation then
      select * into r from public.clients
       where lower(name) = lower(v) or (k <> '' and public.client_key(name) = k) order by id limit 1;
    end;
  end if;
  return jsonb_build_object('id', r.id, 'name', r.name);
end $$;

grant execute on function public.find_or_create_client(text) to authenticated;
revoke execute on function public.find_or_create_client(text) from anon, public;

-- Clients page for all users: any approved user may rename or delete a client.
-- A client that is used by interviews, assessments or closers cannot be deleted (foreign keys block it).
drop policy if exists clients_admin on public.clients;
drop policy if exists clients_delete on public.clients;
create policy clients_admin on public.clients for update to authenticated using (public.is_approved()) with check (public.is_approved());
create policy clients_delete on public.clients for delete to authenticated using (public.is_approved());

-- 15. Closers for all users: users see and manage closers of THEIR OWN candidates; admins see all
drop policy if exists closers_admin_read on public.closers;
drop policy if exists closers_read on public.closers;
create policy closers_read on public.closers for select to authenticated
  using (public.is_admin() or (public.is_approved() and public.owns_candidate(candidate_id)));

-- Upload a closer list (admin: any candidate; user: only their own candidates)
create or replace function public.import_closers(p_month date, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; cid bigint; clid bigint; td text; n int := 0; iid bigint;
        ev date := (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date;
begin
  if not public.is_approved() then raise exception 'Not allowed'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    cid := (r->>'candidate_id')::bigint; clid := (r->>'client_id')::bigint;
    continue when cid is null or clid is null;
    continue when not public.is_admin() and not public.owns_candidate(cid);
    td := nullif(btrim(coalesce(r->>'tool_drive', '')), '');
    if td is null then
      select x.tool_drive into td from interviews x
       where x.candidate_id = cid and x.client_id = clid
         and x.interview_status not in ('Cancelled','Date Pending') and x.round <> 'Loop'
         and coalesce(x.tool_drive, '') <> ''
       order by x.round_rank desc, x.sort_key desc limit 1;
    end if;
    insert into closers (candidate_id, client_id, closer_month, role, salary, tool_drive)
    values (cid, clid, date_trunc('month', p_month)::date, r->>'role', r->>'salary', td)
    on conflict (candidate_id, client_id) do update set
      closer_month = excluded.closer_month, role = excluded.role, salary = excluded.salary, tool_drive = excluded.tool_drive;
    select x.id into iid from interviews x
     where x.candidate_id = cid and x.client_id = clid
       and x.interview_status not in ('Cancelled','Date Pending','Rescheduled') and x.round <> 'Loop'
     order by x.round_rank desc, x.sort_key desc limit 1;
    if iid is not null then
      update interviews set placement_status = 'Placed' where id = iid and placement_status is distinct from 'Placed';
    end if;
    perform public._placement_incentives(cid, clid, td, ev, null, true);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Edit a closer (role, salary, Tool Drive, list month); placement incentives follow
create or replace function public.update_closer(p_id bigint, p_role text, p_salary text, p_tool_drive text, p_month date) returns void
language plpgsql security definer set search_path = public as $$
declare c public.closers%rowtype; td text := nullif(btrim(coalesce(p_tool_drive, '')), ''); m date; ev date;
begin
  select * into c from public.closers where id = p_id;
  if not found then raise exception 'Closer not found'; end if;
  if not (public.is_admin() or (public.is_approved() and public.owns_candidate(c.candidate_id))) then raise exception 'Not allowed'; end if;
  m := date_trunc('month', coalesce(p_month, c.closer_month))::date;
  ev := (m + interval '1 month' - interval '1 day')::date;
  update public.closers set role = btrim(coalesce(p_role, '')), salary = btrim(coalesce(p_salary, '')), tool_drive = td, closer_month = m where id = p_id;
  perform public._placement_incentives(c.candidate_id, c.client_id, td, ev, null, true);
end $$;

-- Delete a closer: removes its unpaid placement incentives and clears Placed on the latest interview
create or replace function public.delete_closer(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare c public.closers%rowtype; iid bigint;
begin
  select * into c from public.closers where id = p_id;
  if not found then raise exception 'Closer not found'; end if;
  if not (public.is_admin() or (public.is_approved() and public.owns_candidate(c.candidate_id))) then raise exception 'Not allowed'; end if;
  delete from public.closers where id = p_id;
  delete from public.incentives where candidate_id = c.candidate_id and client_id = c.client_id
     and incentive_type like 'Final + Placed%' and status = 'Pending' and approval_status <> 'Pending Approval';
  select x.id into iid from public.interviews x
   where x.candidate_id = c.candidate_id and x.client_id = c.client_id
     and x.interview_status not in ('Cancelled','Date Pending','Rescheduled') and x.round <> 'Loop'
   order by x.round_rank desc, x.sort_key desc limit 1;
  if iid is not null then
    update public.interviews set placement_status = null where id = iid and placement_status = 'Placed';
  end if;
end $$;

revoke execute on function public.import_closers(date, jsonb), public.update_closer(bigint, text, text, text, date), public.delete_closer(bigint) from anon, public;
grant execute on function public.import_closers(date, jsonb), public.update_closer(bigint, text, text, text, date), public.delete_closer(bigint) to authenticated;

-- 16. Sheet update date = the date a call was added (editable; defaults to today in IST)
alter table public.interviews add column if not exists sheet_date date;
update public.interviews set sheet_date = (created_at at time zone 'Asia/Kolkata')::date where sheet_date is null;
alter table public.interviews alter column sheet_date set default ((now() at time zone 'Asia/Kolkata')::date);
create index if not exists interviews_sheet_date on public.interviews (sheet_date);

create or replace view public.interview_records_all with (security_invoker = false) as
  select i.id, c.name as candidate, i.role, cl.name as client, i.interview_date, i.interview_time,
         i.duration_minutes, i.round, tm.name as technical_poc, i.interview_type,
         i.interview_status, i.sort_key, public.owns_candidate(i.candidate_id) as is_mine, i.prep_status,
         i.tool_drive, i.sheet_date
  from interviews i
  join candidates c on c.id = i.candidate_id
  join clients cl on cl.id = i.client_id
  left join team_members tm on tm.id = c.technical_poc_id
  where public.is_approved();
revoke all on public.interview_records_all from anon;
grant select on public.interview_records_all to authenticated;

-- 17. Candidates without a Technical POC: visible to every approved user; a Technical POC can claim one
create or replace view public.unassigned_candidates with (security_invoker = false) as
  select c.id, c.name, c.assigned_domains, c.marketing_poc, c.location, c.created_at,
         (select count(*) from interviews i where i.candidate_id = c.id) as interviews,
         (select max(i.interview_date) from interviews i where i.candidate_id = c.id) as last_interview,
         (select string_agg(distinct cl.name, ', ') from interviews i join clients cl on cl.id = i.client_id where i.candidate_id = c.id) as clients
  from candidates c
  where c.technical_poc_id is null and c.active and public.is_approved();
revoke all on public.unassigned_candidates from anon;
grant select on public.unassigned_candidates to authenticated;

create or replace function public.claim_candidate(p_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare m bigint := public.my_member_id(); n text;
begin
  if not public.is_approved() then raise exception 'Not allowed'; end if;
  if m is null or not exists (select 1 from team_members where id = m and is_technical_poc) then
    raise exception 'Only Technical POCs on the team list can take a candidate';
  end if;
  update candidates set technical_poc_id = m where id = p_id and technical_poc_id is null returning name into n;
  if n is null then raise exception 'This candidate already has a Technical POC'; end if;
  return n;
end $$;

revoke execute on function public.claim_candidate(bigint) from anon, public;
grant execute on function public.claim_candidate(bigint) to authenticated;

-- 10. LAST: lock down functions (keep this section at the end)
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
alter default privileges in schema public revoke execute on functions from public, anon;
grant execute on function public.is_admin(), public.is_approved(), public.my_member_id(),
  public.owns_candidate(bigint), public.is_team_name(text),
  public.propose_incentive_edit(bigint, numeric, text, text),
  public.review_incentive(bigint, boolean), public.import_closers(date, jsonb),
  public.name_key(text), public.phone_key(text), public.client_key(text), public.find_or_create_client(text), public.update_closer(bigint, text, text, text, date), public.delete_closer(bigint) to authenticated;


-- =====================================================================
-- TTOP Portal: PART 11 - AUTOMATIC GOOGLE DOC SYNC (6:00 AM and 6:00 PM IST)
-- Run ONCE in the Supabase SQL editor. Safe to re-run. Keeps all existing data.
-- BEFORE RUNNING: replace the two values in the "settings" block at the bottom:
--   YOUR-APP.vercel.app   -> your portal's address
--   YOUR_CRON_SECRET      -> the same text you put in CRON_SECRET on Vercel
-- =====================================================================

-- 1. One row per sync run (shown in the portal header and notifications)
create table if not exists public.sync_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  ok boolean not null,
  added int not null default 0,
  updated int not null default 0,
  skipped int not null default 0,
  new_candidates int not null default 0,
  review int not null default 0,
  failed int not null default 0,
  triggered_by text,
  message text,
  error text
);
alter table public.sync_runs enable row level security;
revoke all on public.sync_runs from anon;
drop policy if exists sync_runs_read on public.sync_runs;
create policy sync_runs_read on public.sync_runs for select to authenticated using (public.is_approved());
create index if not exists sync_runs_at on public.sync_runs (ran_at desc);

-- 2. Every doc line already imported, so a line is imported only once
--    (an interview someone cancels or deletes in the portal is not brought back by the next sync)
create table if not exists public.doc_sync_lines (
  key text primary key,
  interview_id bigint references public.interviews(id) on delete set null,
  first_seen timestamptz not null default now()
);
alter table public.doc_sync_lines enable row level security;   -- no policies: only the server job uses it
revoke all on public.doc_sync_lines from anon, authenticated;

-- 2b. Admin "Auto Sync" page: what happened to each doc line, and in which run
alter table public.doc_sync_lines
  add column if not exists action text,      -- added / rescheduled / updated / already / skipped / failed
  add column if not exists run_at timestamptz;
create index if not exists doc_sync_lines_run on public.doc_sync_lines (run_at desc);
grant select on public.doc_sync_lines to authenticated;
drop policy if exists doc_sync_lines_admin_read on public.doc_sync_lines;
create policy doc_sync_lines_admin_read on public.doc_sync_lines for select to authenticated using (public.is_admin());

-- 3. Schedule: 00:30 UTC = 6:00 AM IST, 12:30 UTC = 6:00 PM IST
create extension if not exists pg_cron;
create extension if not exists pg_net;


-- TTOP Portal: one-time cleanup of client names saved with a trailing dash or colon
-- (e.g. "Transpharmation-" -> "Transpharmation"). Safe to re-run. Run in the Supabase SQL editor.
-- If the clean name already exists, the two clients are merged: interviews, assessments,
-- closers and incentives move to the clean one, then the dashed one is deleted.
do $$
declare d record; k bigint; clean text;
begin
  for d in select id, name from public.clients where name ~ '[[:space:]\-–—:,]+$' loop
    clean := btrim(regexp_replace(d.name, '[[:space:]\-–—:,]+$', ''));
    continue when clean = '';
    select id into k from public.clients where id <> d.id and lower(name) = lower(clean) limit 1;
    if k is null then
      update public.clients set name = clean where id = d.id;
    else
      delete from public.incentives i using public.incentives j
        where i.client_id = d.id and j.client_id = k and i.candidate_id = j.candidate_id
          and i.round_label = j.round_label and i.incentive_type = j.incentive_type;
      update public.incentives  set client_id = k where client_id = d.id;
      delete from public.closers c using public.closers x
        where c.client_id = d.id and x.client_id = k and c.candidate_id = x.candidate_id;
      update public.closers     set client_id = k where client_id = d.id;
      update public.assessments set client_id = k where client_id = d.id;
      update public.interviews  set client_id = k where client_id = d.id;
      delete from public.clients where id = d.id;
    end if;
  end loop;
end $$;

-- Check: should return no rows
select id, name from public.clients where name ~ '[[:space:]\-–—:,]+$';


-- =====================================================================
-- TTOP Portal: TURN ON the automatic Google Doc sync (6:00 AM and 6:00 PM IST)
-- Supabase > SQL Editor > New query > paste this whole file > change the 2 lines marked ⬇ > Run
-- Safe to run again (it replaces the old schedule).
-- =====================================================================

-- Tables the sync writes to (skipped if they already exist)
create table if not exists public.sync_runs (
  id bigint generated always as identity primary key, ran_at timestamptz not null default now(), ok boolean not null,
  added int not null default 0, updated int not null default 0, skipped int not null default 0, new_candidates int not null default 0,
  review int not null default 0, failed int not null default 0, triggered_by text, message text, error text);
alter table public.sync_runs enable row level security;
drop policy if exists sync_runs_read on public.sync_runs;
create policy sync_runs_read on public.sync_runs for select to authenticated using (public.is_approved());
create table if not exists public.doc_sync_lines (key text primary key, interview_id bigint references public.interviews(id) on delete set null, first_seen timestamptz not null default now());
alter table public.doc_sync_lines add column if not exists action text, add column if not exists run_at timestamptz;
alter table public.doc_sync_lines enable row level security;
grant select on public.doc_sync_lines to authenticated;
drop policy if exists doc_sync_lines_admin_read on public.doc_sync_lines;
create policy doc_sync_lines_admin_read on public.doc_sync_lines for select to authenticated using (public.is_admin());

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  -- ⬇ 1. Your portal address (the one you open in the browser) + /api/sync-doc
  app_url text := 'https://ttop-portal.vercel.app/api/sync-doc';
  -- ⬇ 2. Exactly the same text as CRON_SECRET in Vercel > Settings > Environment Variables
  secret  text := 'YOUR_CRON_SECRET';   -- never commit the real secret
  cmd text;
begin
  if app_url like '%YOUR-APP%' or secret = 'YOUR_CRON_SECRET' then
    raise notice 'Doc auto-sync NOT scheduled: put your CRON_SECRET in the line above (do not save it in GitHub), then run supabase/turn_on_auto_sync.sql.';
    return;
  end if;
  cmd := format($c$select net.http_get(url := %L, headers := jsonb_build_object('Authorization', %L), timeout_milliseconds := 120000)$c$,
                app_url, 'Bearer ' || secret);
  perform cron.unschedule(jobname) from cron.job where jobname in ('ttop-doc-sync-6am', 'ttop-doc-sync-6pm');
  perform cron.schedule('ttop-doc-sync-6am', '30 0 * * *', cmd);   -- 00:30 UTC = 6:00 AM IST
  perform cron.schedule('ttop-doc-sync-6pm', '30 12 * * *', cmd);  -- 12:30 UTC = 6:00 PM IST
  execute cmd;                                                      -- one test sync right now
end $$;

-- You should see 2 rows, both active = true
select jobname, schedule, active from cron.job where jobname like 'ttop-doc-sync%';

-- =====================================================================
-- WAIT ~30 SECONDS, then select ONLY the line below and click Run.
-- status_code 200 = working. Anything else: copy the row and send it.
-- =====================================================================
-- select status_code, left(content::text, 300) as reply, created from net._http_response order by id desc limit 1;

-- TTOP Portal: Approve / Remove / Restore users (Team page > User approvals)
-- Safe to run on the live database: it only adds one column. No data is deleted.
-- Supabase > SQL Editor > paste > Run.

alter table public.profiles add column if not exists removed boolean not null default false;

-- A removed user can no longer use the portal (approved = false); admins can restore them.
-- Admins already have permission to update profiles (policy profiles_admin_update), so nothing else is needed.

-- Check:
select email, role, approved, removed from public.profiles order by removed, approved, email;

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

-- ---------- PART: INTERVIEW INBOX (recruiter emails) ----------
-- =====================================================================
-- TTOP Portal: Interview Inbox (interviews from recruiter emails)
-- Run once in Supabase > SQL Editor. Safe on the live database: it only ADDS columns, an index and 3 tables.
-- No data is changed or deleted. (The recruiter-email MySQL database is never written to.)
-- =====================================================================

-- 1. Where an interview came from (set only when it is added from the Interview Inbox)
alter table public.interviews
  add column if not exists source_account_id bigint,      -- recruiter DB accounts.id (the mailbox)
  add column if not exists source_thread_id  text,        -- Gmail thread id
  add column if not exists source_message_id bigint;      -- recruiter_messages.id used to fill the form

-- One interview per email thread. A rescheduled copy of it (rescheduled_from set) is allowed.
create unique index if not exists interviews_source_thread_uq
  on public.interviews (source_account_id, source_thread_id)
  where source_thread_id is not null and rescheduled_from is null;

-- 2. Threads someone dismissed (Undo removes the row)
create table if not exists public.interview_inbox_dismissed (
  thread_key    text primary key,                         -- "<account_id>.<gmail_thread_id>"
  account_id    bigint not null,
  thread_id     text not null,
  dismissed_by  text,
  dismissed_at  timestamptz not null default now()
);

-- 3. Extracted fields per thread (re-extracted only when a new email arrives in the thread)
create table if not exists public.interview_inbox_threads (
  thread_key      text primary key,
  account_id      bigint not null,
  thread_id       text not null,
  sig             text not null,                          -- extractor version : email count : newest id
  last_at         timestamptz not null,                   -- newest email in the thread
  last_message_id bigint not null,
  stage           text,                                   -- INTERVIEW / SCHEDULING (newest email)
  student_email   text,
  mailbox         text,
  n               int not null default 0,
  fields          jsonb not null default '{}'::jsonb,
  extracted_at    timestamptz not null default now()
);
create index if not exists interview_inbox_threads_student on public.interview_inbox_threads (student_email);

-- 4. Small key/value state (first message id on/after the start date, so MySQL reads stay fast)
create table if not exists public.interview_inbox_state (key text primary key, value text, updated_at timestamptz not null default now());

-- Only the server (service role) uses these tables: RLS on, no policies for browsers.
alter table public.interview_inbox_dismissed enable row level security;
alter table public.interview_inbox_threads   enable row level security;
alter table public.interview_inbox_state     enable row level security;
revoke all on public.interview_inbox_dismissed, public.interview_inbox_threads, public.interview_inbox_state from anon, authenticated;

-- Check: 3 new columns on interviews and 3 new tables
select column_name from information_schema.columns where table_schema = 'public' and table_name = 'interviews' and column_name like 'source\_%' order by 1;
select table_name from information_schema.tables where table_schema = 'public' and table_name like 'interview_inbox%' order by 1;

-- ---------- PART: LIVE UPDATES ----------
-- =====================================================================
-- TTOP Portal: live updates (changes made by others appear without reloading the page)
-- Supabase > SQL Editor > paste > Run. Safe on the live database and safe to run again.
-- It only turns on Supabase Realtime for these tables. Row-level security still applies:
-- each person only receives changes to rows they are allowed to see.
-- =====================================================================
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['interviews','candidates','assessments','clients','team_members','incentives','closers','import_review','sync_runs','profiles'] loop
    if to_regclass('public.' || t) is not null and not exists (
         select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Check: the tables that now send live updates
select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' order by 1;

-- ---------- PART: INTERVIEW INBOX FETCH EVERY 4 HOURS ----------
-- =====================================================================
-- TTOP Portal: fetch recruiter emails into the Interview Inbox automatically, EVERY 4 HOURS
-- (6:15 AM, 10:15 AM, 2:15 PM, 6:15 PM, 10:15 PM and 2:15 AM IST)
-- Supabase > SQL Editor > paste this whole file > Run. Safe to run again (it replaces the old schedule).
--
-- You normally do NOT need to change anything: the portal address and CRON_SECRET are copied from the
-- Google Doc auto-sync schedule (turn_on_auto_sync.sql). If that schedule does not exist, fill in the 2 lines marked ⬇.
-- Run interview_inbox.sql first.
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  -- ⬇ only needed if the doc auto-sync is not set up: portal address + /api/interview-inbox/refresh
  app_url text := 'https://YOUR-APP.vercel.app/api/interview-inbox/refresh';
  -- ⬇ only needed if the doc auto-sync is not set up: same text as CRON_SECRET in Vercel
  secret  text := 'YOUR_CRON_SECRET';
  old text; cmd text;
begin
  if app_url like '%YOUR-APP%' or secret = 'YOUR_CRON_SECRET' then
    select command into old from cron.job where jobname = 'ttop-doc-sync-6am';
    if old is null then
      raise notice 'Interview Inbox fetch NOT scheduled (the doc sync schedule is not set up yet). Run supabase/interview_inbox_schedule.sql later.';
      return;
    end if;
    app_url := regexp_replace(substring(old from 'url := ''([^'']+)'''), '/api/sync-doc.*$', '/api/interview-inbox/refresh');
    secret  := substring(old from 'Bearer ([^'']+)''');
    if app_url is null or secret is null then
      raise exception 'Could not read the address / secret from the doc sync schedule. Fill in the two lines marked ⬇';
    end if;
  end if;
  cmd := format($c$select net.http_post(url := %L, body := '{}'::jsonb, headers := jsonb_build_object('Authorization', %L, 'Content-Type', 'application/json'), timeout_milliseconds := 60000)$c$,
                app_url, 'Bearer ' || secret);
  perform cron.unschedule(jobname) from cron.job where jobname = 'ttop-inbox-fetch-4h';
  perform cron.schedule('ttop-inbox-fetch-4h', '45 0,4,8,12,16,20 * * *', cmd);   -- UTC; = 6:15, 10:15, 14:15, 18:15, 22:15, 02:15 IST
  execute cmd;                                                                     -- one fetch right now
  raise notice 'Scheduled every 4 hours: %', app_url;
end $$;

-- You should see 1 row, active = true
select jobname, schedule, active from cron.job where jobname = 'ttop-inbox-fetch-4h';

-- =====================================================================
-- WAIT ~30 SECONDS, then select ONLY the line below and click Run.
-- status_code 200 = working. Anything else: copy the row and send it.
-- =====================================================================
-- select status_code, left(content::text, 300) as reply, created from net._http_response order by id desc limit 1;

-- ---------- PART: 1ST ROUNDS "ADD TO MY LIST" ----------
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
