-- TTOP Portal: run this ONCE if you already ran doc_sync_setup.sql (safe to re-run).
-- Adds what the admin "Auto Sync" page needs.

-- 2b. Admin "Auto Sync" page: what happened to each doc line, and in which run
alter table public.doc_sync_lines
  add column if not exists action text,      -- added / rescheduled / updated / already / skipped / failed
  add column if not exists run_at timestamptz;
create index if not exists doc_sync_lines_run on public.doc_sync_lines (run_at desc);
grant select on public.doc_sync_lines to authenticated;
drop policy if exists doc_sync_lines_admin_read on public.doc_sync_lines;
create policy doc_sync_lines_admin_read on public.doc_sync_lines for select to authenticated using (public.is_admin());
