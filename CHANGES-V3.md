# TTOP V3 – what changed (Phases 1-4)

## Deploy
1. Replace `apps-script/Code.gs` (+ `appsscript.json`) in your Apps Script project -> Deploy -> Manage deployments -> pencil -> New version.
2. Upload everything else to GitHub Pages.
3. In the Google Sheet, rename the Interviews column header "Call Support" -> "Call Support 1" (keeps existing data).
4. New sheets ("Clients", "Audit Log") and new columns (Assigned User, Interview Source, Call Support 2, prep fields, Rescheduled From ID) are created automatically on first sync.
5. Existing candidates have no "Assigned User" yet: as admin, open each candidate (or edit the sheet column with the user's EMAIL). Non-admins only see candidates assigned to them.

## Phase 1  Clients entity, Interview Source (Assessment Based / Direct), Assigned User + server-side row filtering
## Phase 2  Today's Interviews page, Calendar (month), reschedule history, Call Support 1/2, preparation fields
## Phase 3  Ctrl/Cmd+K search opening records, Candidate 360 tabs, duplicate detection, KPI drill-down
## Phase 4  Audit Log (admin-only), CSV export on every list + Client Report, persistent filters, Client 360 tabs, extra notifications

## Not built
- Calendar Week/Day views; Excel/PDF export (CSV only); guided step-by-step interview wizard;
  month filter shared across all pages; Master Data screen; Audit Log is not tamper-proof against someone editing the Sheet directly.
