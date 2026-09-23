# TTOP → Google Drive / Sheets backend

The portal is a static front-end, so it can't write to Drive or a Sheet by itself.
This Apps Script (`Code.gs`) is the small backend that does it. It does two things:

1. **File uploads** — Task Files, Solution Files, Resume, etc. are uploaded to a Drive
   folder per candidate, and the portal stores the real Drive link.
2. **Two-way workbook sync** — one Google Sheets workbook holds six sheets:
   `Candidates`, `Assessments`, `Interviews`, `Incentives`, `Candidate POC Team`, `Support Team`.
   Changes made in the portal appear in the workbook within a few seconds. Rows you
   type, edit or delete directly in the workbook appear back in the portal within
   about 30 seconds, or immediately if you click the **☁️ Sync** button in the top bar.

## Setup

1. Create a Drive folder for assessment files, and a **new, otherwise-empty** Google
   Sheets workbook (the six data sheets above, plus a seventh **Users** sheet for
   sign-in, are created automatically the first time anyone syncs — don't pre-create
   them yourself). Copy each one's ID from its URL (the long string between `/d/`
   and `/edit`).
2. Go to https://script.google.com → New project → paste in `Code.gs`. Fill in
   `ROOT_FOLDER_ID` and `SHEET_ID` at the top, and set `SECRET` to a long random
   string (or keep the one already agreed with your team — it must match what's
   entered in the portal's Settings page).
3. Deploy → New deployment → type **Web app** → Execute as **Me** → Who has access
   **Anyone**. Authorise the Drive + Sheets permissions when asked, then copy the
   Web app URL (ends in `/exec`).
4. In TTOP → Settings → **Google Drive & Sheets**, paste the Web app URL and the
   same secret, and save. The portal starts syncing automatically.

## Sign-in & admin approval

TTOP is gated behind Google sign-in: nobody sees any data until they sign in with
their Google account AND an admin approves them.

1. Google Cloud Console → **APIs & Services → Credentials → Create Credentials →
   OAuth client ID** → Application type **Web application**. Under **Authorized
   JavaScript origins**, add the exact URL where you're hosting TTOP (e.g.
   `https://yourname.github.io` — no path, no trailing slash). Copy the Client ID
   it gives you (ends in `.apps.googleusercontent.com`).
2. Paste that Client ID in **two** places — they must match exactly:
   - `CLIENT_ID` near the top of `js/auth.js`
   - `GOOGLE_CLIENT_ID` near the top of `Code.gs`
3. In `Code.gs`, add your own email to `ADMIN_EMAILS`. Anyone listed there is
   always treated as an approved admin, no matter what the Users sheet says — this
   is how you get in the first time, and how you recover access later if needed.
4. Redeploy the Apps Script (Deploy → Manage deployments → edit → **New version**
   → Deploy) so it picks up `GOOGLE_CLIENT_ID` and `ADMIN_EMAILS`.
5. Open TTOP and sign in with the email you added to `ADMIN_EMAILS`. You'll land
   straight in the app with an **Admin** link in the sidebar.

**How everyone else gets in:** when someone new signs in with Google, they land on
a "Waiting for approval" screen and a row appears in the **Users** sheet (and on
the Admin page) with Status = `pending`. Approve them from the Admin page, or by
editing the Status cell in the Users sheet directly, and they're in — no redeploy
needed, changes there take effect immediately. You can also promote a user to
`admin` the same way, either from the Admin page's Role dropdown or in the sheet.

**Redeploying after an edit to `Code.gs`:** use Deploy → Manage deployments → edit
(pencil) → Version: **New version** → Deploy. The `/exec` URL stays the same, so
nothing needs to change in the portal.

## How the sync works

- Every sheet gets one extra column on the right: **Record ID**. It's how a row
  is matched between the Sheet and the portal — don't edit it, but everything
  else in the sheet is a normal, editable column; there is no hidden/JSON column.
- Typing a new row directly into the Sheet works — leave Record ID blank and the
  portal assigns one the next time it syncs, then writes it back into that cell.
- One display-only trade-off of not having a hidden column: for an already-uploaded
  Task File / Solution File / Resume / JD / Script File, the little "✓ Saved to
  Google Drive · filename.pdf" detail is not stored in the Sheet. After that
  record round-trips through the Sheet once, its chip shows the link only (still
  fully clickable) instead of the original filename.
- Deleting a row in the Sheet deletes that record in the portal, and vice versa.
- If you add your own extra columns, or reorder the existing ones, that's fine —
  columns are matched by their header text, not their position.
- Dates typed into the Sheet are read in **day-first** form (21/09/2026 or
  21-Sep-2026), matching how Sheets shows Indian dates.
- If a sheet is cleared by hand with nothing else going on, the portal treats that
  as an accident and refills it from its own data rather than wiping itself.

## Notes

- "Anyone" access means the Web app URL is public; the `SECRET` is a first,
  coarse gate. The real access control is sign-in + admin approval: even with a
  correct `SECRET`, reading or writing data (uploads and the Candidates/
  Assessments/etc. sync) is refused unless the request carries a valid session
  from an **approved** account. Keep the URL and secret reasonably private
  anyway, and change the secret if it ever leaks.
- Only one workbook is supported. If several people run the portal with different
  Web app URLs, each is a separate, disconnected copy.
