# TTOP Portal (Vercel + Supabase)

Files: `index.html` (the app), `api/config.js` (reads env vars), and `../supabase/schema.sql`.

1. In Supabase (or via the Vercel Marketplace integration), run `supabase/schema.sql`. First add your admin emails to `admin_emails`.
2. Auth > Providers > Google: enable it. Add your Vercel URL under Auth > URL Configuration (Site URL and Redirect URLs).
3. Vercel: import this folder as a project (no build step). Env vars: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the Marketplace integration adds these; otherwise copy them from Supabase > Project Settings > API).
4. Add Team members (Admin > Team is read-only in this version, so insert rows in `team_members`) and clients, then sign in with Google.

Not included yet: Google Sheet sync, Drive uploads (only file names are saved), live updates between users (reload to see others' changes).
