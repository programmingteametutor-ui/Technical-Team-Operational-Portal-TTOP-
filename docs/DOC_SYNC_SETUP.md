# Automatic Google Doc sync: setup (one time, about 15 minutes)

After this, the portal reads the **Sirian Interview Tracker 2026** doc by itself at **6:00 AM and 6:00 PM IST**, adds the new interviews, and shows a notification in the portal:

- **Bell notification** with a badge: "Sheet updated at 16 Oct, 6:00 pm · 7 new interviews · 3 to review". The badge clears when you open the bell.
- **Pop-up message** the next time anyone opens the portal after a sync (or within 5 minutes if the portal is already open; the lists refresh by themselves).
- **Header badge** "Sheet updated 16 Oct, 6:00 pm", and the full summary under Settings.
- If the doc can't be read, the notification says "Sheet update failed" with the reason.

## 1. Let the server read the doc
In the Google Doc: **Share → General access → Anyone with the link → Viewer**. (It already opens without sign-in; keep it that way.)

## 2. Add the files to your Vercel project
- `api/sync-doc.js` → put it in the `api` folder next to `api/config.js`
- `index.html` → replaces your current one
- Deploy.

## 3. Vercel environment variables
Project → Settings → Environment Variables:

| Name | Value |
|---|---|
| `SUPABASE_URL` | already there if you use the Vercel Supabase integration |
| `SUPABASE_SERVICE_ROLE_KEY` | already there with the integration; otherwise Supabase → Project Settings → API → `service_role` |
| `CRON_SECRET` | any long random text, e.g. `ttop-7f3k29xq-sync-88d1` |

Redeploy after adding them.

## 4. Test it (nothing is saved)
Open in a browser:
`https://YOUR-APP.vercel.app/api/sync-doc?dry=1&key=YOUR_CRON_SECRET`
You should see `"ok": true`, how many lines were read, and the first parsed interviews.

## 5. Turn on the schedule
Open `doc_sync_setup.sql`, change `YOUR-APP.vercel.app` and `YOUR_CRON_SECRET` in the settings block, then run it in the Supabase SQL editor.
To run one right away: portal → Settings → **Sync now** (admins).

## How the import behaves
- Same reading rules as "Import from Google Doc" (date headings, `-gopi` = Technical POC, 1:30 AM stays on that day's list).
- Each doc line is imported **once**. Lines already in the portal are skipped, and an interview you cancel or delete is not brought back.
- New candidates are created with name + POC (fill in details later). If the POC name is not on the Team list, the candidate appears on **Unassigned**.
- No time in the doc → saved as **Date Pending**; when a later version of the doc gives the time, that interview is updated instead of duplicated.
- Same candidate + client + round already exists → added as a separate interview and listed on **Import Review** to confirm a reschedule (lines that say "resched" are linked automatically).

## Admin "Auto Sync" page
Sidebar → **Auto Sync** (admins only). It lists every interview the doc sync brought in, with filters for:
- **Interview date**
- **Round**: All rounds / 1st round / Above 1st round
- **Sync run** (e.g. "16 Oct, 6:00 am") and **Result** (Added, Time filled, Already in portal, Not imported)
- Search by candidate, client, role or POC; Export CSV

It also shows the history of every sync run. If you already ran `doc_sync_setup.sql` before this page existed, run `doc_sync_page.sql` once in Supabase.
