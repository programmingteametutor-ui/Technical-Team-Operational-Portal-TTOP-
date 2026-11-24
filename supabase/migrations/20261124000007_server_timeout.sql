-- =====================================================================
-- Give the app's server key time for large saves.
-- Supabase stops API requests after about 8 seconds by default. Importing a
-- large Dhruva tab (20,000+ rows) is one save (gs_commit) and needs longer:
--   "canceling statement due to statement timeout" (57014).
-- Only the server key (service_role) gets the longer limit; the browser keys
-- (anon, authenticated) keep Supabase's defaults. The app's Vercel function
-- may run 5 minutes, so 4 minutes here stays inside it.
-- Safe to run again.
-- =====================================================================

alter role service_role set statement_timeout = '240s';

-- PostgREST applies role settings when it reloads its configuration
notify pgrst, 'reload config';
