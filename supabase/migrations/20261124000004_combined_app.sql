-- =====================================================================
-- Interview Operations Portal (TTOP + Dhruva) — combined app layer
--
-- Run AFTER the TTOP schema exists (it is already live in TTOP's Supabase
-- project) and after the three dhruva_* migrations. Keeps all data.
-- Safe to run again. Does not change any TTOP table or function; it only
-- ADDS tables and triggers.
--
--   app_users          one row per person: role + which portals they may open
--                        super_admin -> both portals (admin in TTOP)
--                        admin       -> their portal(s), with admin rights
--                        user        -> their portal(s), limited data
--   TTOP access        app_users drives TTOP's own access flags
--                        (profiles.approved / role / removed and admin_emails),
--                      so TTOP's row-level security keeps enforcing it.
--   app_master_links   which Dhruva Candidate/Client Master ID is which
--                      TTOP candidate/client (shared masters)
-- =====================================================================

create table if not exists public.app_users (
  email      text primary key check (email = lower(btrim(email)) and email like '%@%'),
  name       text,
  role       text not null default 'user' check (role in ('super_admin','admin','user')),
  portals    text[] not null default '{}' check (portals <@ array['ttop','dhruva']::text[]),
  active     boolean not null default true,
  updated_by text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.app_master_links (
  kind        text not null check (kind in ('candidate','client')),
  dhruva_id   text not null,            -- CAN-000083 / CLI-000030 (Dhruva master ID)
  entity_id   bigint not null,          -- public.candidates.id / public.clients.id
  ttop_name   text not null,            -- TTOP name seen at the last sync
  dhruva_name text not null,            -- Dhruva name seen at the last sync
  updated_at  timestamptz not null default now(),
  primary key (kind, dhruva_id)
);
create index if not exists app_master_links_entity on public.app_master_links (kind, entity_id);

create table if not exists public.app_state (
  key text primary key, value text, updated_at timestamptz not null default now()
);

alter table public.app_users        enable row level security;
alter table public.app_master_links enable row level security;
alter table public.app_state        enable row level security;
revoke all on public.app_users, public.app_master_links, public.app_state from anon, authenticated;

-- super_admin always has both portals
create or replace function public.app_users_normalize() returns trigger
language plpgsql set search_path = public as $$
begin
  new.email := lower(btrim(new.email));
  if new.role = 'super_admin' then new.portals := array['ttop','dhruva'];
  else new.portals := array(select distinct p from unnest(coalesce(new.portals, '{}')) p order by p);
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists t_app_users_normalize on public.app_users;
create trigger t_app_users_normalize before insert or update on public.app_users
  for each row execute function public.app_users_normalize();

-- ---------------------------------------------------------------------
-- TTOP access follows app_users
--   TTOP access  = active and 'ttop' in portals
--   TTOP admin   = that, and role super_admin/admin
-- ---------------------------------------------------------------------
create or replace function public.app_apply_ttop_access(p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare u app_users%rowtype; e text := lower(btrim(p_email)); ok boolean; adm boolean; known boolean;
begin
  perform set_config('app.applying_access', 'on', true);   -- our own profile updates are not mirrored back
  select * into u from app_users where email = e;
  known := found;
  ok  := known and u.active and 'ttop' = any(u.portals);
  adm := ok and u.role in ('super_admin','admin');
  if adm then
    insert into admin_emails (email) values (e) on conflict do nothing;
  else
    delete from admin_emails where lower(email) = e;
  end if;
  if ok then
    update profiles set approved = true, removed = false, role = case when adm then 'admin' else 'user' end
     where lower(email) = e and (approved is distinct from true or removed or role is distinct from case when adm then 'admin' else 'user' end);
  elsif known then
    -- known person without TTOP access: blocked in TTOP
    update profiles set approved = false, removed = true, role = 'user'
     where lower(email) = e and (approved or not removed or role <> 'user');
  end if;
  perform set_config('app.applying_access', 'off', true);
end $$;
revoke all on function public.app_apply_ttop_access(text) from public, anon, authenticated;

create or replace function public.trg_app_users_ttop() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    delete from admin_emails where lower(email) = old.email;
    update profiles set approved = false, removed = true, role = 'user' where lower(email) = old.email;
    return old;
  end if;
  perform public.app_apply_ttop_access(new.email);
  if tg_op = 'UPDATE' and old.email <> new.email then perform public.app_apply_ttop_access(old.email); end if;
  return new;
end $$;
drop trigger if exists t_app_users_ttop on public.app_users;
create trigger t_app_users_ttop after insert or update or delete on public.app_users
  for each row execute function public.trg_app_users_ttop();

-- A new Google sign-in: TTOP's own handle_new_user() creates the profile first.
-- If the person is in app_users, their app role decides. If not, TTOP's own rule
-- decided (team members / admin emails are approved) and the person is added to
-- app_users with TTOP access, so the app and TTOP agree.
create or replace function public.trg_profile_app_access() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.applying_access', true) = 'on' then return new; end if;   -- change made by app_apply_ttop_access
  if exists (select 1 from app_users where email = lower(btrim(new.email))) then
    if tg_op = 'INSERT' then
      perform public.app_apply_ttop_access(new.email);
    else
      -- a TTOP admin approved / removed / changed a role on TTOP's Team page: mirror it into app_users
      update app_users a set
        portals = case
          when new.approved and not new.removed then array(select distinct p from unnest(a.portals || array['ttop']) p)
          else array_remove(a.portals, 'ttop') end,
        role = case
          when a.role = 'super_admin' then 'super_admin'
          when new.approved and not new.removed and new.role = 'admin' then 'admin'
          when new.approved and not new.removed and new.role = 'user' and a.role = 'admin' and not ('dhruva' = any(a.portals)) then 'user'
          else a.role end,
        updated_by = coalesce((select auth.jwt() ->> 'email'), 'ttop')
      where a.email = lower(btrim(new.email));
      perform public.app_apply_ttop_access(new.email);   -- e.g. a super admin cannot be removed from TTOP
    end if;
  elsif new.approved and not coalesce(new.removed, false) then
    insert into app_users (email, name, role, portals, updated_by)
    values (lower(btrim(new.email)), new.name, case when new.role = 'admin' then 'admin' else 'user' end, array['ttop'], 'ttop')
    on conflict (email) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists t_zz_profile_app_access on public.profiles;
create trigger t_zz_profile_app_access after insert or update of approved, role, removed on public.profiles
  for each row execute function public.trg_profile_app_access();

-- ---------------------------------------------------------------------
-- Seed from TTOP: everyone TTOP currently lets in keeps exactly that access.
-- (Dhruva's users are added by the server on first start, from Dhruva's
--  V2 User Access tab, and merged with these rows.)
-- ---------------------------------------------------------------------
insert into public.app_users (email, name, role, portals, updated_by)
select lower(btrim(p.email)), p.name,
       case when p.role = 'admin' then 'admin' else 'user' end, array['ttop'], 'seed: ttop'
  from public.profiles p
 where p.approved and not coalesce(p.removed, false)
on conflict (email) do nothing;

insert into public.app_users (email, role, portals, updated_by)
select lower(btrim(a.email)), 'admin', array['ttop'], 'seed: ttop admin_emails' from public.admin_emails a
on conflict (email) do nothing;

-- Check
select role, portals, count(*) from public.app_users group by 1, 2 order by 1, 2;
