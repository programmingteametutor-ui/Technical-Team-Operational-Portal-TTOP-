/* ============================================================
   TTOP – storage.js
   All localStorage reads/writes go through this module so the
   rest of the app never touches localStorage directly. This is
   Assessment files and rows are additionally synced to Google
   Drive / Sheets by drive.js.
   ============================================================ */

const Storage = (() => {

  const KEYS = {
    assessments: "ttop_assessments",
    interviews: "ttop_interviews",
    candidates: "ttop_candidates",
    incentives: "ttop_incentives",
    candidatePocTeam: "ttop_candidate_poc_team",
    supportTeam: "ttop_support_team",
    activity: "ttop_activity",
    settings: "ttop_settings",
    seeded: "ttop_seeded_v2",
    samplePurged: "ttop_sample_purged_v1",
    migrated: "ttop_migrated_poc_v3"
  };

  function _get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error("Storage read failed for", key, e);
      return fallback;
    }
  }

  function _set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error("Storage write failed for", key, e);
      Utils.toast("Could not save to local storage (it may be full).", "error");
      return false;
    }
  }

  /* ---- change notifications (used by sync.js) ------------------- */
  // insert / update / remove announce themselves so every change can be pushed to the Google Sheet.
  // saveAll() is deliberately silent: it is what sync.js uses to write data that CAME FROM the Sheet.
  const listeners = [];
  function onChange(fn) { listeners.push(fn); }
  function emit(ev) { listeners.forEach(fn => { try { fn(ev); } catch (e) { console.error("Storage listener failed", e); } }); }

  /* ---- generic collection helpers ------------------------- */
  function getAll(collection) { return _get(KEYS[collection], []); }
  function saveAll(collection, arr) { return _set(KEYS[collection], arr); }

  function insert(collection, record) {
    const arr = getAll(collection);
    arr.unshift(record);
    saveAll(collection, arr);
    emit({ collection, op: "upsert", id: record.id });
    return record;
  }

  function update(collection, id, patch) {
    const arr = getAll(collection);
    const idx = arr.findIndex(r => r.id === id);
    if (idx === -1) return null;
    arr[idx] = { ...arr[idx], ...patch };
    saveAll(collection, arr);
    emit({ collection, op: "upsert", id });
    return arr[idx];
  }

  function remove(collection, id) {
    const arr = getAll(collection);
    const next = arr.filter(r => r.id !== id);
    saveAll(collection, next);
    const removed = next.length !== arr.length;
    if (removed) emit({ collection, op: "delete", id });
    return removed;
  }

  function find(collection, id) {
    return getAll(collection).find(r => r.id === id) || null;
  }

  /* ---- activity feed ---------------------------------------- */
  function logActivity(text, icon = "🔔") {
    const arr = getAll("activity");
    arr.unshift({ id: Utils.generateId("ACT"), text, icon, ts: new Date().toISOString() });
    saveAll("activity", arr.slice(0, 50));
  }

  /* ---- settings ------------------------------------------------ */
  function getSettings() {
    return _get(KEYS.settings, { theme: "light", sidebarCollapsed: false });
  }
  function saveSettings(patch) {
    const cur = getSettings();
    const next = { ...cur, ...patch };
    _set(KEYS.settings, next);
    return next;
  }

  /* ---- first run / clean-up ------------------------------------ */

  /** IDs of the old built-in sample records, removed once from browsers that already have them */
  const SAMPLE_IDS = {
    candidates: ["CAND-1", "CAND-2", "CAND-3", "CAND-4", "CAND-5", "CAND-6"],
    assessments: ["AS-1001", "AS-1002", "AS-1003", "AS-1004", "AS-1005", "AS-1006", "AS-1007", "AS-1008", "AS-1009", "AS-1010"],
    interviews: ["IV-2001", "IV-2002", "IV-2003", "IV-2004", "IV-2005", "IV-2006", "IV-2007", "IV-2008"],
    incentives: ["INC-3001", "INC-3002", "INC-3003", "INC-3004", "INC-3005", "INC-3006", "INC-3007", "INC-3008", "INC-3009", "INC-3010"],
    activity: ["ACT-1", "ACT-2", "ACT-3", "ACT-4", "ACT-5", "ACT-6", "ACT-7"]
  };

  /** One-time: delete the sample records (by ID only — anything you entered yourself is untouched) */
  function purgeSampleData() {
    if (_get(KEYS.samplePurged, false)) return;
    Object.entries(SAMPLE_IDS).forEach(([col, ids]) => {
      const arr = getAll(col);
      const next = arr.filter(r => !ids.includes(r.id));
      if (next.length !== arr.length) saveAll(col, next);
    });
    _set(KEYS.samplePurged, true);
  }

  /** First run in a browser: start empty, with the default team roster */
  function initIfNeeded() {
    if (!_get(KEYS.seeded, false)) {
      ["candidates", "assessments", "interviews", "incentives", "activity"].forEach(c => saveAll(c, []));
      saveAll("candidatePocTeam", DefaultTeam.candidatePocTeam);
      saveAll("supportTeam", DefaultTeam.supportTeam);
      _set(KEYS.seeded, true);
    }
    migratePocModel();
    purgeSampleData();
  }

  /**
   * One-time migration for data saved before the POC model change.
   * Candidate POC Team == Technical POC, so a candidate now has ONE
   * POC field (candidatePOC). The old separate candidate.technicalPOC
   * (which pointed at the Support Team) and interview.technicalPOC
   * are dropped; Technical POC is derived from the candidate at
   * render time. Safe to run repeatedly (pass force=true after an import).
   */
  function migratePocModel(force = false) {
    if (!force && _get(KEYS.migrated, false)) return;
    const pocNames = getAll("candidatePocTeam").map(t => t.name);
    saveAll("candidates", getAll("candidates").map(c => {
      const { technicalPOC, ...rest } = c;
      const poc = rest.candidatePOC || (pocNames.includes(technicalPOC) ? technicalPOC : "");
      return { ...rest, candidatePOC: poc };
    }));
    saveAll("interviews", getAll("interviews").map(i => {
      const { technicalPOC, ...rest } = i;
      return rest;
    }));
    _set(KEYS.migrated, true);
  }

  function exportAll() {
    return {
      exportedAt: new Date().toISOString(),
      candidates: getAll("candidates"),
      assessments: getAll("assessments"),
      interviews: getAll("interviews"),
      incentives: getAll("incentives"),
      candidatePocTeam: getAll("candidatePocTeam"),
      supportTeam: getAll("supportTeam"),
      activity: getAll("activity")
    };
  }

  function importAll(payload) {
    ["candidates", "assessments", "interviews", "incentives", "candidatePocTeam", "supportTeam", "activity"].forEach(col => {
      if (Array.isArray(payload[col])) {
        saveAll(col, payload[col]);
        emit({ collection: col, op: "replace" });   // an import overwrites the shared Sheet too
      }
    });
    _set(KEYS.seeded, true);
    migratePocModel(true);
  }

  return {
    KEYS, getAll, saveAll, insert, update, remove, find, onChange,
    logActivity, getSettings, saveSettings,
    initIfNeeded, migratePocModel, exportAll, importAll
  };
})();
