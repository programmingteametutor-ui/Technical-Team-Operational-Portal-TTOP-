/**
 * TTOP – Google Apps Script backend
 *   1. Drive uploads (assessment files)
 *   2. Two-way sync between the portal and ONE Google Sheets workbook
 *      (sheets: Candidates, Assessments, Interviews, Incentives, Candidate POC Team, Support Team)
 *
 * Setup: see README.md in this folder.
 * After editing this file: Deploy -> Manage deployments -> edit (pencil) -> Version: New version -> Deploy.
 */
// Paste just the ID (the long string in the URL), e.g. from
// https://drive.google.com/drive/folders/1c-KZBd6e...  ->  1c-KZBd6e...
// https://docs.google.com/spreadsheets/d/1v_Xqnbx.../edit  ->  1v_Xqnbx...
// A full URL pasted by mistake is also accepted (extractId() below unwraps it),
// so this can't silently break sync again.
const ROOT_FOLDER_ID = 'https://drive.google.com/drive/folders/1c-KZBd6e76e1sSJt05VYVJkVKoUzt_cN';   // Drive folder where candidate folders are created
const SHEET_ID       = 'https://docs.google.com/spreadsheets/d/1v_XqnbxyQIgdqckyZDVC108vKksjHGPDbXIar1uzTDk/edit?usp=sharing';    // the ONE workbook that holds every sheet
const SECRET         = 'CandidateAssessmentsTracker'; // must match the secret in TTOP (Settings -> Google Drive & Sheets)

// ---- Sign-in ----
// The OAuth Client ID from Google Cloud Console (Credentials -> OAuth client ID -> Web application).
// Must match CLIENT_ID in js/auth.js exactly, or sign-in will fail.
const GOOGLE_CLIENT_ID = 'PASTE-YOUR-GOOGLE-OAUTH-CLIENT-ID.apps.googleusercontent.com';
// Emails here are always treated as an approved admin, no matter what the Users sheet says.
// This is how you get in the first time (and how you recover access if the sheet is ever edited wrong).
const ADMIN_EMAILS = ['you@example.com'];
const SESSION_DAYS = 7; // how long a browser stays signed in before it has to re-verify with Google

/** Accepts either a bare Drive/Sheets ID or a full URL containing one, and returns just the ID. */
function extractId(v) {
  const s = String(v || '').trim();
  const m = s.match(/\/(?:folders|d)\/([a-zA-Z0-9_-]{15,})/); // .../folders/<id>/... or .../d/<id>/...
  return m ? m[1] : s;
}

/* ------------------------------------------------------------------ */

function doGet() {
  return out({ ok: true, service: 'TTOP backend', version: 2 });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.secret !== SECRET) return out({ ok: false, error: 'Unauthorized' });

    // Sign-in actions: no approved session needed yet — this is how one gets created.
    if (req.action === 'authGoogle') return out(authGoogle(req));
    if (req.action === 'authSession') return out(authSession(req));
    if (req.action === 'listUsers') return out(listUsers(req));
    if (req.action === 'setUserStatus') return out(setUserStatus(req));
    if (req.action === 'setUserRole') return out(setUserRole(req));

    // Everything else needs a signed-in, admin-approved user — the shared secret alone is not enough,
    // since it's visible to anyone who opens the browser's dev tools.
    const session = requireApprovedSession_(req);
    if (session.error) return out({ ok: false, error: session.error, authRequired: true });

    if (req.action === 'upload') return out(upload(req));
    if (req.action === 'sync') return out(syncAll(req));
    return out({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------ Drive ------------------------------ */

function candidateFolder(candidate, client) {
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const name = (candidate + ' - ' + client).replace(/[\\/:*?"<>|]/g, '_');
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

function upload(req) {
  const folder = candidateFolder(req.candidate, req.client);
  const blob = Utilities.newBlob(Utilities.base64Decode(req.data), req.mimeType, req.field + '_' + req.fileName);
  const file = folder.createFile(blob);
  // Files inherit the folder's sharing. Uncomment to make each file link-viewable:
  // file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { ok: true, id: file.getId(), url: file.getUrl(), folderUrl: folder.getUrl() };
}

/* --------------------------- Workbook sync --------------------------- */
/*
 * The portal sends:  { action:'sync', schemas:{ <collection>: {sheet, idHeader, jsonHeader, prefix, headers[]} },
 *                      ops:[ {op:'upsert', col, id, values:{header:value}} | {op:'delete', col, id}
 *                          | {op:'replace', col, rows:[{header:value}]} ], pull:true|false }
 * It applies the ops (in order, under a lock) and, if pull is true, returns every sheet's rows as
 * objects keyed by header. Columns are matched by HEADER NAME, so you can reorder columns or add
 * your own extra columns in the Sheet — they are left alone.
 */

function syncAll(req) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(extractId(SHEET_ID));
    const tz = ss.getSpreadsheetTimeZone();
    const ctx = {};
    Object.keys(req.schemas).forEach(function (col) { ctx[col] = prepareSheet(ss, req.schemas[col]); });

    const touched = {};
    (req.ops || []).forEach(function (op) {
      const c = ctx[op.col];
      if (c) { applyOp(c, op); touched[op.col] = true; }
    });

    // A per-sheet counter that goes up whenever the PORTAL changes that sheet. It lets a browser tell
    // "someone deleted this in the portal" (counter moved) from "the sheet was cleared by hand" (it did not).
    const props = PropertiesService.getScriptProperties();
    const epochs = {};
    Object.keys(ctx).forEach(function (col) {
      let e = Number(props.getProperty('epoch_' + col) || 0);
      if (touched[col]) { e++; props.setProperty('epoch_' + col, String(e)); }
      epochs[col] = e;
    });

    let data;
    if (req.pull) {
      data = {};
      Object.keys(ctx).forEach(function (col) { data[col] = readSheet(ctx[col], tz); });
    }
    SpreadsheetApp.flush();
    return { ok: true, data: data, epochs: epochs, url: ss.getUrl(), at: new Date().toISOString() };
  } finally {
    lock.releaseLock();
  }
}

/** Find/create the sheet, make sure every header exists (missing ones are appended on the right) */
function prepareSheet(ss, schema) {
  let sh = ss.getSheetByName(schema.sheet);
  if (!sh) sh = ss.insertSheet(schema.sheet);

  const lastCol = sh.getLastColumn();
  let headers = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  const isNew = headers.every(function (h) { return h === ''; });
  if (isNew) headers = [];

  const missing = schema.headers.filter(function (h) { return headers.indexOf(h) === -1; });
  if (missing.length) {
    sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold').setBackground('#E7ECFF');
    headers = headers.concat(missing);
    if (isNew) sh.setFrozenRows(1);
  }
  const idx = {};
  headers.forEach(function (h, i) { if (h !== '' && !(h in idx)) idx[h] = i; });
  return { sh: sh, headers: headers, idx: idx, idCol: idx[schema.idHeader], schema: schema };
}

function findRow(c, id) {
  const last = c.sh.getLastRow();
  if (last < 2) return -1;
  const ids = c.sh.getRange(2, c.idCol + 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(id)) return i + 2;
  }
  return -1;
}

/** Text is written as plain text ("@") so Sheets never turns "2-3", phone numbers or dates into something else */
function fmtFor(v) { return typeof v === 'number' ? 'General' : '@'; }

/** Make sure the sheet has at least `rows` rows (a new sheet starts with 1000) */
function ensureRows(c, rows) {
  const max = c.sh.getMaxRows();
  if (rows > max) c.sh.insertRowsAfter(max, Math.max(200, rows - max));
}

function writeRow(c, rowNum, values) {
  ensureRows(c, rowNum);
  const n = c.headers.length;
  const range = c.sh.getRange(rowNum, 1, 1, n);
  const exists = rowNum <= c.sh.getLastRow();
  const row = exists ? range.getValues()[0] : new Array(n).fill('');
  const fmts = range.getNumberFormats()[0];
  Object.keys(values).forEach(function (h) {
    const i = c.idx[h];
    if (i === undefined) return;
    row[i] = values[h];
    fmts[i] = fmtFor(values[h]);
  });
  range.setNumberFormats([fmts]);
  range.setValues([row]);
}

function applyOp(c, op) {
  if (op.op === 'upsert') {
    let r = findRow(c, op.id);
    if (r === -1) r = c.sh.getLastRow() + 1;
    writeRow(c, r, op.values || {});
  } else if (op.op === 'delete') {
    const r = findRow(c, op.id);
    if (r !== -1) c.sh.deleteRow(r);
  } else if (op.op === 'replace') {
    const n = c.headers.length;
    const last = c.sh.getLastRow();
    if (last > 1) c.sh.getRange(2, 1, last - 1, n).clearContent();
    const rows = op.rows || [];
    if (rows.length) {
      const data = [], fmts = [];
      rows.forEach(function (rec) {
        const row = new Array(n).fill(''), f = new Array(n).fill('@');
        Object.keys(rec).forEach(function (h) {
          const i = c.idx[h];
          if (i === undefined) return;
          row[i] = rec[h];
          f[i] = fmtFor(rec[h]);
        });
        data.push(row);
        fmts.push(f);
      });
      ensureRows(c, rows.length + 1);
      const range = c.sh.getRange(2, 1, rows.length, n);
      range.setNumberFormats(fmts);
      range.setValues(data);
    }
  }
}

/** Sheet cell -> plain JSON value (dates become YYYY-MM-DD, time-of-day cells become what you see) */
function cellToPlain(v, shown, tz) {
  if (v instanceof Date) {
    if (v.getFullYear() < 1900) return String(shown).trim();           // a time-of-day cell (e.g. 7:30 PM)
    const s = Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm');
    return s.slice(-6) === ' 00:00' ? s.slice(0, 10) : s;
  }
  if (typeof v === 'number') return v;
  return String(v).trim();
}

function newId(prefix) {
  return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 9).toUpperCase();
}

/** Read every data row. Rows you typed straight into the Sheet (no Record ID) get one assigned here. */
function readSheet(c, tz) {
  const last = c.sh.getLastRow();
  if (last < 2) return [];
  const n = c.headers.length;
  const range = c.sh.getRange(2, 1, last - 1, n);
  const vals = range.getValues();
  const shown = range.getDisplayValues();
  const idHeader = c.schema.idHeader, jsonHeader = c.schema.jsonHeader;

  const out = [], seen = {}, fixes = [];
  for (let r = 0; r < vals.length; r++) {
    const rec = {};
    let hasData = false;
    c.schema.headers.forEach(function (h) {
      const i = c.idx[h];
      const v = cellToPlain(vals[r][i], shown[r][i], tz);
      rec[h] = v;
      if (v !== '' && h !== idHeader && h !== jsonHeader) hasData = true;
    });
    if (!hasData) continue;                                             // blank / leftover row
    let id = String(rec[idHeader] || '').trim();
    if (!id || seen[id]) {                                              // new row typed in the Sheet, or a copied row
      id = newId(c.schema.prefix);
      fixes.push({ row: r + 2, id: id });
    }
    seen[id] = true;
    rec[idHeader] = id;
    out.push(rec);
  }
  fixes.forEach(function (f) {
    const cell = c.sh.getRange(f.row, c.idCol + 1);
    cell.setNumberFormat('@');
    cell.setValue(f.id);
  });
  return out;
}

/* --------------------------- Sign-in / Users --------------------------- */
/*
 * One extra sheet, "Users", holds everyone who has ever signed in:
 *   Email | Name | Role (admin/user) | Status (pending/approved/rejected) |
 *   Requested At | Approved At | Last Login At
 * You can edit Role/Status by hand directly in that sheet — it's read fresh
 * on every request, so a change there takes effect immediately (no redeploy).
 * ADMIN_EMAILS (top of this file) always wins over whatever is in the sheet.
 */

const USERS_SHEET = 'Users';
const USERS_HEADERS = ['Email', 'Name', 'Role', 'Status', 'Requested At', 'Approved At', 'Last Login At'];

function usersSheet_() {
  const ss = SpreadsheetApp.openById(extractId(SHEET_ID));
  let sh = ss.getSheetByName(USERS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(USERS_SHEET);
    sh.getRange(1, 1, 1, USERS_HEADERS.length).setValues([USERS_HEADERS]).setFontWeight('bold').setBackground('#E7ECFF');
    sh.setFrozenRows(1);
  }
  return sh;
}

function usersHeaderIndex_(sh) {
  const last = sh.getLastColumn();
  const headers = last > 0 ? sh.getRange(1, 1, 1, last).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  const idx = {};
  headers.forEach(function (h, i) { if (h && !(h in idx)) idx[h] = i; });
  return idx;
}

function findUserRow_(sh, idx, email) {
  const last = sh.getLastRow();
  if (last < 2 || idx['Email'] === undefined) return -1;
  const emails = sh.getRange(2, idx['Email'] + 1, last - 1, 1).getValues();
  const target = String(email).trim().toLowerCase();
  for (let i = 0; i < emails.length; i++) {
    if (String(emails[i][0]).trim().toLowerCase() === target) return i + 2;
  }
  return -1;
}

function readUserRow_(sh, idx, row) {
  const n = sh.getLastColumn();
  const vals = sh.getRange(row, 1, 1, n).getValues()[0];
  const rec = {};
  Object.keys(idx).forEach(function (h) { rec[h] = vals[idx[h]]; });
  return rec;
}

function ensureUsersRows_(sh, row) {
  const max = sh.getMaxRows();
  if (row > max) sh.insertRowsAfter(max, Math.max(50, row - max));
}

function writeUserRow_(sh, idx, row, patch) {
  ensureUsersRows_(sh, row);
  Object.keys(patch).forEach(function (h) {
    if (idx[h] === undefined) return;
    sh.getRange(row, idx[h] + 1).setNumberFormat('@').setValue(patch[h]);
  });
}

/** Current Role/Status for an email, read fresh from the sheet (not from any cached token). */
function liveUser_(email) {
  const sh = usersSheet_();
  const idx = usersHeaderIndex_(sh);
  const row = findUserRow_(sh, idx, email);
  if (row === -1) return null;
  return readUserRow_(sh, idx, row);
}

/** Verify a Google Identity Services credential (JWT) via Google's own verification endpoint. */
function verifyGoogleCredential_(credential) {
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential || ''), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  const payload = JSON.parse(res.getContentText());
  if (payload.aud !== GOOGLE_CLIENT_ID) return null;                         // token wasn't issued for this app
  if (payload.email_verified !== 'true' && payload.email_verified !== true) return null;
  return payload; // { email, name, picture, exp, ... }
}

function b64url_(bytes) { return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, ''); }

/** Small signed, expiring session token — HMAC-SHA256 over the payload using SECRET as the key. */
function signSession_(payload) {
  const body = b64url_(Utilities.newBlob(JSON.stringify(payload)).getBytes());
  const sig = b64url_(Utilities.computeHmacSha256Signature(body, SECRET));
  return body + '.' + sig;
}

function verifySession_(token) {
  if (!token || token.indexOf('.') === -1) return null;
  const parts = token.split('.');
  const expected = b64url_(Utilities.computeHmacSha256Signature(parts[0], SECRET));
  if (parts[1] !== expected) return null;
  let payload;
  try { payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString()); }
  catch (e) { return null; }
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

function newSessionToken_(email, name) {
  return signSession_({ email: email, name: name, exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000 });
}

/** Verifies the session token AND re-checks the Users sheet, so a revoke/approve takes effect immediately. */
function requireApprovedSession_(req) {
  const session = verifySession_(req.sessionToken);
  if (!session) return { error: 'Please sign in again.' };
  const email = String(session.email).trim().toLowerCase();
  const isSeedAdmin = ADMIN_EMAILS.map(function (x) { return x.toLowerCase(); }).indexOf(email) !== -1;
  const live = liveUser_(email);
  if (!live && !isSeedAdmin) return { error: 'Account not found. Please sign in again.' };
  const status = isSeedAdmin ? 'approved' : String(live['Status'] || '').toLowerCase();
  if (status !== 'approved') return { error: 'Your account is ' + (status || 'pending') + '. Ask an admin to approve it.' };
  const role = isSeedAdmin ? 'admin' : String(live['Role'] || 'user').toLowerCase();
  return { email: email, name: session.name, role: role };
}

function requireAdminSession_(req) {
  const r = requireApprovedSession_(req);
  if (r.error) return r;
  if (r.role !== 'admin') return { error: 'Admins only.' };
  return r;
}

/** Sign in (or sign up) with a Google Identity Services credential. */
function authGoogle(req) {
  const payload = verifyGoogleCredential_(req.credential);
  if (!payload) return { ok: false, error: 'Could not verify that Google sign-in. Make sure GOOGLE_CLIENT_ID in Code.gs matches CLIENT_ID in js/auth.js.' };
  const email = String(payload.email).trim().toLowerCase();
  const name = payload.name || email;
  const now = new Date().toISOString();
  const isSeedAdmin = ADMIN_EMAILS.map(function (x) { return x.toLowerCase(); }).indexOf(email) !== -1;

  const sh = usersSheet_();
  const idx = usersHeaderIndex_(sh);
  let row = findUserRow_(sh, idx, email);

  if (row === -1) {
    row = sh.getLastRow() + 1;
    writeUserRow_(sh, idx, row, {
      'Email': email, 'Name': name,
      'Role': isSeedAdmin ? 'admin' : 'user',
      'Status': isSeedAdmin ? 'approved' : 'pending',
      'Requested At': now, 'Approved At': isSeedAdmin ? now : '', 'Last Login At': now
    });
  } else {
    const patch = { 'Name': name, 'Last Login At': now };
    if (isSeedAdmin) { patch['Role'] = 'admin'; patch['Status'] = 'approved'; }
    writeUserRow_(sh, idx, row, patch);
  }

  const live = readUserRow_(sh, idx, row);
  const status = isSeedAdmin ? 'approved' : String(live['Status'] || 'pending').toLowerCase();
  const role = isSeedAdmin ? 'admin' : String(live['Role'] || 'user').toLowerCase();

  if (status !== 'approved') return { ok: true, status: status, email: email, name: name };
  return { ok: true, status: 'approved', email: email, name: name, role: role, sessionToken: newSessionToken_(email, name) };
}

/** Silently re-verify (and refresh) an existing session, e.g. when a tab is reopened. */
function authSession(req) {
  const r = requireApprovedSession_(req);
  if (r.error) return { ok: false, error: r.error };
  return { ok: true, status: 'approved', email: r.email, name: r.name, role: r.role, sessionToken: newSessionToken_(r.email, r.name) };
}

function listUsers(req) {
  const r = requireAdminSession_(req);
  if (r.error) return { ok: false, error: r.error };
  const sh = usersSheet_();
  const idx = usersHeaderIndex_(sh);
  const last = sh.getLastRow();
  if (last < 2) return { ok: true, users: [] };
  const vals = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  const users = vals
    .filter(function (row) { return String(row[idx['Email']]).trim(); })
    .map(function (row) {
      const rec = {};
      Object.keys(idx).forEach(function (h) { rec[h] = row[idx[h]]; });
      return rec;
    });
  return { ok: true, users: users };
}

function setUserStatus(req) {
  const r = requireAdminSession_(req);
  if (r.error) return { ok: false, error: r.error };
  if (['pending', 'approved', 'rejected'].indexOf(req.status) === -1) return { ok: false, error: 'Invalid status.' };
  const sh = usersSheet_();
  const idx = usersHeaderIndex_(sh);
  const row = findUserRow_(sh, idx, req.email);
  if (row === -1) return { ok: false, error: 'User not found.' };
  const patch = { 'Status': req.status };
  if (req.status === 'approved') patch['Approved At'] = new Date().toISOString();
  writeUserRow_(sh, idx, row, patch);
  return { ok: true };
}

function setUserRole(req) {
  const r = requireAdminSession_(req);
  if (r.error) return { ok: false, error: r.error };
  if (['user', 'admin'].indexOf(req.role) === -1) return { ok: false, error: 'Invalid role.' };
  const sh = usersSheet_();
  const idx = usersHeaderIndex_(sh);
  const row = findUserRow_(sh, idx, req.email);
  if (row === -1) return { ok: false, error: 'User not found.' };
  writeUserRow_(sh, idx, row, { 'Role': req.role });
  return { ok: true };
}
