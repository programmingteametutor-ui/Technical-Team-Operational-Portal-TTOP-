# Interview Inbox ("Email review" in the menu): setup

The Interview Inbox page lists interview and scheduling emails from recruiters, received from the go-live date onwards, with one row per email thread. It fills in the Add Interview form from each thread; you check it and save it.

## Files

| File | What it is |
|---|---|
| `index.html` | Adds the **Interview Inbox** page (Interviews group in the menu). The Add Interview form is now shared by the Add Interview page and the inbox. |
| `api/interview-inbox/index.js` | `GET /api/interview-inbox`: the list (filters, pages) |
| `api/interview-inbox/[id].js` | `GET /api/interview-inbox/:messageId`: one email, its text and the thread |
| `api/interview-inbox/refresh.js` | Reads new emails into the inbox. Runs every 4 hours, or from **Fetch now** |
| `api/interview-inbox/[id]/dismiss.js` | `POST` / `DELETE /api/interview-inbox/:threadKey/dismiss`: dismiss and undo |
| `api/_lib/inbox.js` | Shared server code: read-only MySQL, sign-in checks, cache, filters |
| `api/_lib/extract.js` | Your `extract.js`, unchanged |
| `package.json` | Adds `mysql2` (Vercel installs it). If your repo already has a `package.json`, add `"mysql2": "3.11.3"` to its `dependencies` instead of replacing it. |
| `supabase/interview_inbox_schedule.sql` | Turns on the automatic fetch every 4 hours (Supabase pg_cron) |
| `supabase/interview_inbox.sql` | Supabase migration (approved): three source columns on `interviews`, one unique index, three new tables |
| `test/` | Tests. Run them with `npm install && npm test` |

## Steps

1. **Supabase:** open SQL Editor, paste `supabase/interview_inbox.sql` and run it. It's safe on live data and can be run again.
2. **MySQL: create a SELECT-only login (recommended).** This login can't write anything, and it can't see the credentials columns:
   ```sql
   CREATE USER 'ttop_inbox'@'%' IDENTIFIED BY '<a long random password>';
   GRANT SELECT ON CareerXceleratorDBPrimary.recruiter_messages TO 'ttop_inbox'@'%';
   GRANT SELECT (id, student_email, google_user_email, status) ON CareerXceleratorDBPrimary.accounts TO 'ttop_inbox'@'%';
   ```
3. **MySQL: allow Vercel to connect.** Vercel functions don't have fixed IP addresses (unless you have Vercel Secure Compute), so the server at `8.234.116.104:3306` must accept connections from the internet. Use the SELECT-only login from step 2 and a strong password. If the server only accepts SSL, tell me and I'll turn SSL on in the connection.
4. **Vercel:** go to Settings → Environment Variables and add:
   - `DB_HOST` = `8.234.116.104`
   - `DB_PORT` = `3306`
   - `DB_USER` = `ttop_inbox` (or `Dev` until step 2 is done)
   - `DB_PASSWORD` = the password for that login
   - `DB_NAME` = `CareerXceleratorDBPrimary`
   - `INTERVIEW_IMPORT_START_DATE` = `2026-10-27` (the go-live day; nothing before 00:00 IST that day is ever read)
   - `INBOX_DB_TIMEZONE` = `UTC` for now; step 6 tells you if it must change

   Then redeploy.
5. **Turn on the automatic fetch:** in Supabase SQL Editor, run `supabase/interview_inbox_schedule.sql`.
   - It fetches new emails every 4 hours: 6:15 AM, 10:15 AM, 2:15 PM, 6:15 PM, 10:15 PM and 2:15 AM IST. It also runs one fetch straight away.
   - It copies your portal address and `CRON_SECRET` from the Google Doc auto-sync schedule, so normally you change nothing.
   - Wait about 30 seconds, then run the last line of the file. `status_code 200` means it works.
6. **Hard refresh** the portal (Ctrl+Shift+R).
7. **Time zone check (admins).** While signed in, open `https://<your portal>/api/interview-inbox?diag=1`.
   - Read the `guess` line. If it says IST, set `INBOX_DB_TIMEZONE` to `+05:30` and redeploy.
   - For the check to be reliable, open it shortly after a new email has arrived.

## How it behaves

- **Who sees what:** admins see every thread. A Technical POC sees threads whose student email matches the email of one of their candidates in the portal.
- **Filling the form:** each field shows "✓ from email: …" or "Not in email". Nothing is invented.
  - Client: the email's company is matched to your client list, ignoring case and Ltd, Inc and the like. If there's no match, the box stays empty and the email's company name is shown. Clients are never created.
  - Duration, Round and Type: filled only when the email value matches one of your options exactly.
  - Time: kept as written in the email, with its time zone. When the zone has a fixed offset (EST, PST, BST and so on), a button converts it to IST.
- **Saving:** goes through the normal Add Interview checks (candidate must exist, duplicates, reschedule or next round).
  - It also warns if the candidate already has an interview with that client on that date.
  - Each thread can be added once; the unique index in Supabase blocks a second add too.
  - After saving, the row shows **Added ✓** with a link to the interview.
- **Dismiss** hides a thread for everyone. Undo is shown straight away, and the **Dismissed** tab can restore it later.
- **When emails arrive:** the inbox is filled every 4 hours by the automatic fetch. **Fetch now** on the page fetches straight away; admins and Technical POCs can use it.
  - The page shows when the last fetch ran, whether it was automatic, and how many threads were updated. A failed fetch is shown in red.
  - Opening the page reads only what was already fetched, so it doesn't touch the email database. Only search and opening an email do.
- **Speed:** a thread is read again only when a new email arrives in it. One fetch reads up to 400 threads at a time and keeps going for up to about 45 seconds; anything left is read at the next fetch.
