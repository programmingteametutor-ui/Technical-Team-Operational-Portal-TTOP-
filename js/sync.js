/* ============================================================
   TTOP – sync.js
   Two-way sync between the portal and ONE Google Sheets
   workbook (see apps-script/Code.gs). One sheet per collection:

     Candidates · Assessments · Interviews · Incentives ·
     Candidate POC Team · Support Team

   PORTAL -> SHEET  Every insert / update / delete is put in a
                    small queue (kept in localStorage, so nothing
                    is lost if the tab closes or you are offline)
                    and sent to the Sheet within ~1 second.
   SHEET -> PORTAL  The portal reads the whole workbook every 30 s,
                    when the tab regains focus, and on "Sync now".
                    Rows you add / edit / delete in the Sheet are
                    reflected in the portal.

   RULES
   - Portal changes are always sent BEFORE the Sheet is read, so a
     change you just made is never overwritten by an older copy.
   - Last write wins per row (whoever saved last).
   - The first time a browser syncs, its existing records are merged
     UP into the Sheet (this browser wins on conflicts); after that
     the Sheet is the shared source of truth.
   - A Sheet that is cleared BY HAND never wipes a browser that still
     has data — the Sheet is refilled from the portal. (Records deleted
     through the portal are deleted everywhere.)
   - Columns are matched by header NAME, so you may reorder columns
     or add your own; unknown columns are left alone.
   - Every field the portal actually uses has its own named column —
     there is no catch-all JSON column. One consequence: the small
     "✓ Saved to Google Drive · filename" detail on an already-uploaded
     Task/Solution/Resume/JD/Script file is a display nicety, not
     stored data — once a record round-trips through the Sheet, that
     file's chip falls back to showing its link only (still fully
     clickable) instead of the original filename.
   ============================================================ */

const Sync = (() => {

  const QUEUE_KEY = "ttop_sync_queue";
  const META_KEY = "ttop_sync_meta";
  const POLL_MS = 30000;
  const FLUSH_DELAY_MS = 1000;
  const ID_HEADER = "Record ID";

  /* -------------------- Sheet layout (one place) -------------------- */
  // c: [Sheet header, record key, kind]   kinds: text (default) | date | number | links
  const c = (h, k, t = "text") => ({ h, k, t });
  const SCHEMAS = {
    candidates: {
      sheet: "Candidates", prefix: "CAND",
      cols: [c("Name", "name"), c("Email", "email"), c("Phone", "phone"), c("Location", "location"),
        c("Experience", "experience"), c("Assigned Domains", "assignedDomains"),
        c("Candidate POC", "candidatePOC"), c("Marketing POC", "marketingPOC"), c("Active Status", "activeStatus")]
    },
    assessments: {
      sheet: "Assessments", prefix: "AS",
      cols: [c("Date of Assessment", "date", "date"), c("Type", "type"), c("Candidate Name", "candidateName"),
        c("Technology/Role", "techRole"), c("Interview Date", "interviewDate", "date"), c("Company/Client", "client"),
        c("Resume", "resume"), c("JD", "jd"), c("Task Files", "taskFiles", "links"), c("Solution Files", "solutionFiles", "links"),
        c("Script File", "scriptFile"), c("Completion Screenshot", "completionScreenshot"), c("Screenshot", "screenshot"),
        c("Coding Assessment Document", "codingDoc"),
        { h: "Done BY", k: null, t: "text", derive: rec => (window.Assessments ? Assessments.getToolDrive(rec) : "") }, // read-only: comes from the interview
        c("Status", "status"), c("Folder Link", "folderLink")]
    },
    interviews: {
      sheet: "Interviews", prefix: "IV",
      cols: [c("Candidate Name", "candidateName"), c("Company/Client", "client"), c("Interview Date", "interviewDate", "date"),
        c("Interview Time", "interviewTime"), c("Duration", "duration"), c("Round", "round"), c("Interview Type", "interviewType"),
        c("Interviewer", "interviewer"), c("Tool Drive (Done By)", "doneBy"), c("Call Support", "assignedPOC"),
        c("Preparation Status", "preparationStatus"), c("Interview Status", "interviewStatus"), c("Placement Status", "placementStatus"),
        c("Linked Assessment ID", "assessmentId")]
    },
    incentives: {
      sheet: "Incentives", prefix: "INC",
      cols: [c("Date", "date", "date"), c("Candidate", "candidate"), c("Company/Client", "client"), c("Round", "round"),
        c("Incentive Type", "incentiveType"), c("Reason", "reason"), c("Tool Drive Person", "toolDrivePerson"),
        c("Candidate POC", "candidatePOC"), c("Amount", "amount", "number"), c("Status", "status")]
    },
    candidatePocTeam: {
      sheet: "Candidate POC Team", prefix: "CPOC",
      cols: [c("Name", "name"), c("Email", "email"), c("Active Status", "activeStatus")]
    },
    supportTeam: {
      sheet: "Support Team", prefix: "SUP",
      cols: [c("Name", "name"), c("Email", "email"), c("Active Status", "activeStatus")]
    }
  };
  const COLLECTIONS = Object.keys(SCHEMAS);

  function schemasPayload() {
    const out = {};
    COLLECTIONS.forEach(col => {
      const s = SCHEMAS[col];
      out[col] = { sheet: s.sheet, prefix: s.prefix, idHeader: ID_HEADER,
        headers: [...s.cols.map(x => x.h), ID_HEADER] };
    });
    return out;
  }

  /* -------------------- value conversion -------------------- */

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const iso = (y, m, d) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  /** Accepts 2026-09-21, 21/09/2026, 21-9-26, 21 Sep 2026 ... (day-first, as used in India) -> 2026-09-21 */
  function normDate(v) {
    if (v == null) return "";
    const s = String(v).trim();
    if (!s) return "";
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return iso(m[1], m[2], m[3]);
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (m) return iso(+m[3] < 100 ? 2000 + +m[3] : m[3], m[2], m[1]);
    m = s.match(/^(\d{1,2})[\s\-]+([A-Za-z]{3,9})\.?[\s\-,]+(\d{2,4})/);
    if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return iso(+m[3] < 100 ? 2000 + +m[3] : m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], m[1]);
    return s; // unrecognised: keep exactly what was typed
  }

  function toNumber(v) {
    if (typeof v === "number") return v;
    const n = parseFloat(String(v ?? "").replace(/[^\d.\-]/g, ""));
    return isNaN(n) ? 0 : n;
  }

  const splitLinks = v => String(v ?? "").split(/[\s,;]+/).map(x => x.trim()).filter(Boolean);

  /** Task/Solution files: array of {url, upload?}; older records stored one link string */
  function linkItems(rec, key) {
    const v = rec[key];
    if (Array.isArray(v)) return v.filter(x => x && x.url);
    if (typeof v === "string" && v) {
      const up = rec.uploads?.[key];
      return [up && up.url === v ? { url: v, upload: up } : { url: v }];
    }
    return [];
  }

  /** portal record -> { "Sheet header": value } */
  function encode(col, rec) {
    const S = SCHEMAS[col];
    const values = {};
    S.cols.forEach(x => {
      if (x.derive) { values[x.h] = x.derive(rec) || ""; return; }
      const v = rec[x.k];
      if (x.t === "links") {
        values[x.h] = linkItems(rec, x.k).map(i => i.url).join("\n"); // file names for these are not stored in the Sheet — see header comment
      } else if (x.t === "number") {
        values[x.h] = (v === "" || v == null || isNaN(Number(v))) ? "" : Number(v);
      } else {
        values[x.h] = v == null ? "" : String(v);
      }
    });
    values[ID_HEADER] = rec.id;
    return values;
  }

  /** { "Sheet header": value } -> portal record */
  function decode(col, values) {
    const S = SCHEMAS[col];
    const rec = {};
    S.cols.forEach(x => {
      if (!x.k) return;
      const raw = values[x.h];
      if (x.t === "links") rec[x.k] = splitLinks(raw).map(url => ({ url })); // uploaded-file name/size is not round-tripped — see header comment
      else if (x.t === "number") rec[x.k] = toNumber(raw);
      else if (x.t === "date") rec[x.k] = normDate(raw);
      else rec[x.k] = raw == null ? "" : String(raw).trim();
    });
    rec.id = String(values[ID_HEADER] ?? "").trim();
    return rec;
  }

  const stable = v => JSON.stringify(v, (k, val) =>
    val && typeof val === "object" && !Array.isArray(val) ? Object.keys(val).sort().reduce((o, key) => (o[key] = val[key], o), {}) : val);
  /** what a record looks like after a round trip through the Sheet — used to tell real changes from noise */
  const canon = (col, rec) => stable(decode(col, encode(col, rec)));
  const canonList = (col, list) => list.map(r => canon(col, r)).join("|");

  /* -------------------- queue of local changes -------------------- */

  let queue = loadQueue();
  let seq = queue.reduce((m, o) => Math.max(m, o.seq || 0), 0);

  function loadQueue() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch (e) { return []; } }
  function saveQueue() { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch (e) { /* storage full: keep in memory */ } }
  function getMeta() { try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch (e) { return {}; } }
  function setMeta(patch) { try { localStorage.setItem(META_KEY, JSON.stringify({ ...getMeta(), ...patch })); } catch (e) { /* ignore */ } }

  /** ev: { collection, op: 'upsert'|'delete'|'replace', id? }  — later changes to the same record replace earlier ones */
  function enqueue(ev) {
    if (!SCHEMAS[ev.collection]) return;
    if (ev.op === "replace") queue = queue.filter(o => o.col !== ev.collection);
    else queue = queue.filter(o => !(o.col === ev.collection && (o.op === "replace" ? false : o.id === ev.id)));
    queue.push({ seq: ++seq, op: ev.op, col: ev.collection, id: ev.id });
    saveQueue();
    updateUI();
    schedule(FLUSH_DELAY_MS);
  }

  /** queue entry -> what is sent (records are read fresh, so the latest edit is always what goes out) */
  function materialize(o) {
    if (o.op === "delete") return { op: "delete", col: o.col, id: o.id };
    if (o.op === "replace") return { op: "replace", col: o.col, rows: Storage.getAll(o.col).slice().reverse().map(r => encode(o.col, r)) };
    const rec = Storage.find(o.col, o.id);
    return rec ? { op: "upsert", col: o.col, id: o.id, values: encode(o.col, rec) } : null;
  }

  /* -------------------- applying the Sheet's state -------------------- */

  /** returns true when local data changed */
  function applyRemote(data, epochs) {
    const meta = getMeta();
    const first = !meta.initialised;
    let changed = false;
    COLLECTIONS.forEach(col => {
      // sheet order is oldest -> newest; the portal keeps newest first
      const remote = (data[col] || []).map(v => decode(col, v)).filter(r => r.id).reverse();
      const local = Storage.getAll(col);
      let next;

      // The Sheet is empty but we still hold data. If nobody changed this sheet through the portal since we last
      // looked (the change counter did not move), it was cleared by hand — refill it. If the counter moved, the
      // records were deleted on purpose, so accept that.
      const prev = meta.epochs?.[col], now = epochs?.[col];
      const clearedByHand = !remote.length && local.length && (prev === undefined || now === undefined || prev === now);

      if (first || clearedByHand) {
        // First sync of this browser (or a Sheet cleared by hand): merge THIS browser's records up into the Sheet
        const remoteById = new Map(remote.map(r => [r.id, r]));
        const localIds = new Set(local.map(r => r.id));
        next = [...local, ...remote.filter(r => !localIds.has(r.id))];
        local.forEach(r => {
          const rr = remoteById.get(r.id);
          if (!rr || canon(col, rr) !== canon(col, r)) enqueue({ collection: col, op: "upsert", id: r.id });
        });
      } else {
        next = remote;   // steady state: the Sheet is the shared source of truth
      }

      if (canonList(col, next) !== canonList(col, local)) {
        Storage.saveAll(col, next);   // silent: does not echo back to the Sheet
        changed = true;
      }
    });
    setMeta({ initialised: true, epochs: epochs || meta.epochs || {} });
    return changed;
  }

  /* -------------------- the sync loop -------------------- */

  let running = false, again = false, timer = null, refresher = null, workbookUrl = "";
  let status = { state: "idle", at: null, error: "" };

  const overlayOpen = () => !!document.querySelector(".overlay.is-open");

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(() => run(), ms);
  }

  async function run() {
    if (running) { again = true; return; }
    running = true;
    setStatus({ state: "syncing" });
    try {
      const sent = queue.slice();
      const ops = sent.map(materialize).filter(Boolean);
      const res = await Drive.call({ action: "sync", schemas: schemasPayload(), ops, pull: true });
      const sentSeqs = new Set(sent.map(o => o.seq));
      queue = queue.filter(o => !sentSeqs.has(o.seq));
      saveQueue();
      if (res.url) workbookUrl = res.url;

      if (queue.length || overlayOpen()) {
        // something changed while we were talking to the Sheet, or a form is open: don't swap data under the user
        again = queue.length > 0;
      } else if (res.data && applyRemote(res.data, res.epochs) && refresher) {
        refresher();
      }
      setStatus({ state: "ok", at: new Date(), error: "" });
    } catch (err) {
      const first = status.state !== "error";
      setStatus({ state: "error", error: err.message || String(err) });
      if (first && window.Utils) Utils.toast(`Could not sync with Google Sheets: ${err.message}. Your changes are saved here and will be sent automatically.`, "warning", 6000);
    } finally {
      running = false;
      if (again) { again = false; schedule(500); }
    }
  }

  /* -------------------- status UI -------------------- */

  function setStatus(patch) { status = { ...status, ...patch }; updateUI(); }

  function updateUI() {
    const pending = queue.length;
    const pill = document.getElementById("syncPill");
    const text = document.getElementById("syncPillText");
    const time = status.at ? status.at.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";
    let label, cls;
    if (status.state === "syncing") { label = "Syncing…"; cls = "is-syncing"; }
    else if (status.state === "error") { label = pending ? `Offline · ${pending} waiting` : "Sync error"; cls = "is-error"; }
    else if (pending) { label = `${pending} waiting`; cls = "is-syncing"; }
    else if (status.at) { label = `Synced ${time}`; cls = "is-ok"; }
    else { label = "Sync"; cls = ""; }
    if (pill) { pill.className = `sync-pill ${cls}`; pill.title = status.error ? `${status.error} — click to retry` : "Click to sync with Google Sheets now"; }
    if (text) text.textContent = label;

    const box = document.getElementById("syncSettingsStatus");
    if (box) box.textContent = status.state === "error" ? `⚠ ${status.error}` :
      status.at ? `✓ Last synced ${time}${pending ? ` · ${pending} change(s) waiting` : ""}` : "Not synced yet";
    const link = document.getElementById("syncWorkbookLink");
    if (link) { link.hidden = !workbookUrl; if (workbookUrl) link.href = workbookUrl; }
  }

  /* -------------------- start -------------------- */

  function start({ refresh } = {}) {
    refresher = refresh || null;
    Storage.onChange(enqueue);
    ["syncPill", "btnSyncNow"].forEach(id => document.getElementById(id)?.addEventListener("click", () => run()));
    document.addEventListener("visibilitychange", () => { if (!document.hidden) run(); });
    window.addEventListener("online", () => run());
    setInterval(() => { if (!document.hidden) run(); }, POLL_MS);
    updateUI();
    run();
  }

  return { start, run, enqueue, encode, decode, normDate, SCHEMAS, pending: () => queue.length, status: () => status };
})();
