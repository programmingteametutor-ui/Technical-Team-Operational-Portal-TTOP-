-- =====================================================================
-- PERMANENTLY deletes the archived Apps Script data (schema archive_dhruva).
-- Run only when you are sure you no longer need it, and after exporting it:
--   pg_dump "$SUPABASE_DB_URL" --schema=archive_dhruva --no-owner -f archive_dhruva.sql
-- This cannot be undone.
-- =====================================================================
drop schema if exists archive_dhruva cascade;
