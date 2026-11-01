-- TTOP Portal: Approve / Remove / Restore users (Team page > User approvals)
-- Safe to run on the live database: it only adds one column. No data is deleted.
-- Supabase > SQL Editor > paste > Run.

alter table public.profiles add column if not exists removed boolean not null default false;

-- A removed user can no longer use the portal (approved = false); admins can restore them.
-- Admins already have permission to update profiles (policy profiles_admin_update), so nothing else is needed.

-- Check:
select email, role, approved, removed from public.profiles order by removed, approved, email;
