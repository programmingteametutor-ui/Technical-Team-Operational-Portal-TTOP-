"use strict";
/**
 * Shared masters: candidates and clients.
 *
 *   TTOP   public.candidates / public.clients          (TTOP reads and writes these directly)
 *   Dhruva "Candidate Master" / "Client Master" tabs    (Interview Portal Control workbook)
 *
 * Both portals keep using their own copy unchanged; this module keeps the two copies
 * the same, in both directions:
 *   - a new candidate/client in either portal is added to the other
 *   - a rename in either portal is copied to the other (each side is compared with the
 *     name last seen there; if both changed, TTOP wins). Pairing never renames anything,
 *     so Dhruva's canonical names (used by its incentive matching) stay as they are.
 *   - deletions are not copied (the link is dropped, the other side keeps its row)
 * Records are paired by the same keys TTOP's duplicate protection uses
 * (name_key for candidates, client_key for clients). Several Dhruva IDs may point to
 * one TTOP record when Dhruva holds duplicates of the same person/company.
 *
 * Modes (app_state 'masters_sync'): report (default: compute only) | on | off
 */
const CONTROL_WB = "1FD5pShmQaqszrcqi1UHXGlsJQBuKPnxJXKFvj7iwjus";
const KINDS = {
  candidate: { table: "candidates", tab: "Candidate Master", prefix: "CAN-", key: nameKey },
  client: { table: "clients", tab: "Client Master", prefix: "CLI-", key: clientKey }
};

/* Same rules as TTOP's SQL name_key() / client_key() */
const ACC_FROM = "áàâäãåéèêëíìîïóòôöõúùûüñç", ACC_TO = "aaaaaaeeeeiiiiooooouuuunc";
function nameKey(t) {
  let s = [...String(t || "").toLowerCase()].map(ch => { const i = ACC_FROM.indexOf(ch); return i >= 0 ? ACC_TO[i] : ch; }).join("");
  s = s.replace(/\b(mr|mrs|ms|dr)\b/g, " ").replace(/[^a-z0-9]+/g, " ");
  return s.split(" ").filter(Boolean).sort().join(" ");
}
function clientKey(t) {
  return String(t || "").toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|company|technologies|technology|tech|group|pvt|plc|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}
const clean = (s) => String(s == null ? "" : s).replace(/[<>]/g, "").replace(/\s+/g, " ").trim();

function createMasters({ runtime, store, rest, log }) {
  let running = null, again = false, lastReport = null, mode = "report", lastTick = 0;

  async function getMode() {
    const r = await rest("GET", "app_state?key=eq.masters_sync&select=value");
    mode = (r[0] && r[0].value) || process.env.MASTERS_SYNC || "report";
    return mode;
  }
  async function setMode(m, by) {
    if (!["on", "off", "report"].includes(m)) throw new Error("Bad mode");
    await rest("POST", "app_state?on_conflict=key", [{ key: "masters_sync", value: m }], { Prefer: "resolution=merge-duplicates,return=minimal" });
    log.log("[masters] sync mode set to " + m + " by " + by);
    mode = m;
  }

  async function fetchAll(table) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const page = await rest("GET", table + "?select=id,name&order=id", undefined, { Range: from + "-" + (from + 999), "Range-Unit": "items" });
      out.push(...page);
      if (page.length < 1000) return out;
    }
  }

  /** Dhruva tab rows: [{row, id, name}] */
  function readDhruva(kind) {
    const wb = store.workbook(CONTROL_WB);
    const s = wb && wb.sheets.find(x => x.name === KINDS[kind].tab);
    if (!s) return null;
    const out = [];
    s.rows.forEach((r, i) => {
      if (!r || i === 0) return;
      const id = String(r.v[0] || "").trim(), name = clean(r.v[1]);
      if (id && name) out.push({ row: i + 1, id, name });
    });
    return out;
  }
  function nextId(rows, prefix) {
    let max = 0;
    for (const r of rows) { const m = new RegExp("^" + prefix + "(\\d+)$").exec(r.id); if (m) max = Math.max(max, Number(m[1])); }
    return (n) => prefix + String(max + n).padStart(6, "0");
  }

  /**
   * One pass. With apply=false only the plan is computed (report mode).
   */
  async function reconcile(apply) {
    const links = await rest("GET", "app_master_links?select=kind,dhruva_id,entity_id,ttop_name,dhruva_name");
    const ttop = { candidate: await fetchAll("candidates"), client: await fetchAll("clients") };
    const plan = { at: new Date().toISOString(), applied: !!apply, candidate: null, client: null, errors: [] };

    // ---- compute the plan synchronously against the current Dhruva data ----
    const work = {};
    for (const kind of Object.keys(KINDS)) {
      const K = KINDS[kind];
      const dh = readDhruva(kind);
      if (!dh) { plan.errors.push("Dhruva tab '" + K.tab + "' not found"); continue; }
      const entities = new Map(ttop[kind].map(e => [e.id, Object.assign({}, e, { name: clean(e.name) })]));
      const byKey = new Map();
      for (const e of entities.values()) { const k = K.key(e.name); if (k && !byKey.has(k)) byKey.set(k, e); }
      const dhById = new Map(dh.map(d => [d.id, d]));
      const myLinks = links.filter(l => l.kind === kind);
      const linkByDh = new Map(myLinks.map(l => [l.dhruva_id, l]));
      const w = { dhRename: [], dhAdd: [], ttRename: [], ttAdd: [], linkUpsert: [], linkDelete: [], conflicts: [] };
      const linkedEntities = new Set();

      // 1. existing links: a rename on one side (vs. the name last seen there) is copied to the other.
      //    Names that simply differ (Dhruva duplicates, casing) are left alone.
      const link = (d, e, ttopName, dhruvaName) => ({ kind, dhruva_id: d, entity_id: e, ttop_name: ttopName, dhruva_name: dhruvaName });
      for (const l of myLinks) {
        const e = entities.get(Number(l.entity_id)), d = dhById.get(l.dhruva_id);
        if (!e || !d) { w.linkDelete.push(l.dhruva_id); continue; }
        linkedEntities.add(e.id);
        const ttChanged = e.name !== l.ttop_name, dhChanged = d.name !== l.dhruva_name;
        if (ttChanged) {
          if (d.name !== e.name) {
            w.dhRename.push({ row: d.row, id: d.id, from: d.name, to: e.name, link: link(d.id, e.id, e.name, e.name) });
            if (dhChanged) w.conflicts.push(d.id + ": renamed in both portals ('" + d.name + "' / '" + e.name + "'); kept TTOP's name");
          } else w.linkUpsert.push(link(d.id, e.id, e.name, d.name));
        } else if (dhChanged) {
          if (d.name !== e.name) w.ttRename.push({ id: e.id, from: e.name, to: d.name, dhruva_id: d.id });
          else w.linkUpsert.push(link(d.id, e.id, e.name, d.name));
        }
      }
      // 2. Dhruva rows without a link: pair by key (names are not changed), else add to TTOP
      const pendingAdd = new Map(); // key -> {name, members[]}
      for (const d of dh) {
        if (linkByDh.has(d.id)) continue;
        const k = K.key(d.name);
        if (!k) continue;
        const e = byKey.get(k);
        if (e) { w.linkUpsert.push(link(d.id, e.id, e.name, d.name)); linkedEntities.add(e.id); }
        else { const p = pendingAdd.get(k) || { name: d.name, members: [] }; p.members.push({ id: d.id, name: d.name }); pendingAdd.set(k, p); }
      }
      w.ttAdd = [...pendingAdd.values()];
      // 3. TTOP records nobody links to: add to Dhruva with a new ID
      const keysInDhruva = new Set(dh.map(d => K.key(d.name)));
      const newId = nextId(dh, K.prefix);
      let n = 0;
      for (const e of entities.values()) {
        if (linkedEntities.has(e.id)) continue;
        const k = K.key(e.name);
        if (!k || keysInDhruva.has(k)) continue;   // paired in step 2 (or pending)
        w.dhAdd.push({ id: newId(++n), name: e.name, entity_id: e.id });
      }
      work[kind] = w;
      plan[kind] = {
        dhruvaRows: dh.length, ttopRows: entities.size, linked: myLinks.length - w.linkDelete.length,
        toLink: w.linkUpsert.length, addToTtop: w.ttAdd.length, addToDhruva: w.dhAdd.length,
        renameInDhruva: w.dhRename.length, renameInTtop: w.ttRename.length, unlink: w.linkDelete.length,
        conflicts: w.conflicts.slice(0, 20),
        examples: {
          addToTtop: w.ttAdd.slice(0, 8).map(x => x.name), addToDhruva: w.dhAdd.slice(0, 8).map(x => x.name),
          renameInDhruva: w.dhRename.slice(0, 5).map(x => x.from + " -> " + x.to), renameInTtop: w.ttRename.slice(0, 5).map(x => x.from + " -> " + x.to)
        }
      };
    }
    if (!apply) { lastReport = plan; return plan; }

    // ---- apply: TTOP side first (inserts give us the new ids) ----
    for (const kind of Object.keys(work)) {
      const K = KINDS[kind], w = work[kind];
      for (const r of w.ttRename) {
        try {
          await rest("PATCH", K.table + "?id=eq." + r.id, { name: r.to }, { Prefer: "return=minimal" });
          w.linkUpsert.push({ kind, dhruva_id: r.dhruva_id, entity_id: r.id, ttop_name: r.to, dhruva_name: r.to });
        } catch (e) {
          plan.errors.push("TTOP rename of " + kind + " '" + r.from + "' to '" + r.to + "' refused: " + e.message.slice(0, 160));
          // TTOP refused (e.g. a duplicate name): remember both names as seen, so it is not retried
          w.linkUpsert.push({ kind, dhruva_id: r.dhruva_id, entity_id: r.id, ttop_name: r.from, dhruva_name: r.to });
        }
      }
      for (let i = 0; i < w.ttAdd.length; i += 100) {
        const batch = w.ttAdd.slice(i, i + 100);
        let created = null;
        try { created = await rest("POST", K.table + "?select=id,name", batch.map(b => ({ name: b.name })), { Prefer: "return=representation" }); }
        catch (e) { created = null; }
        if (created && created.length === batch.length) {
          batch.forEach((b, j) => b.members.forEach(m => w.linkUpsert.push({ kind, dhruva_id: m.id, entity_id: created[j].id, ttop_name: clean(created[j].name), dhruva_name: m.name })));
          continue;
        }
        for (const b of batch) {  // one by one (a duplicate somewhere in the batch)
          try {
            const c = await rest("POST", K.table + "?select=id,name", [{ name: b.name }], { Prefer: "return=representation" });
            b.members.forEach(m => w.linkUpsert.push({ kind, dhruva_id: m.id, entity_id: c[0].id, ttop_name: clean(c[0].name), dhruva_name: m.name }));
          } catch (e) { plan.errors.push("Could not add " + kind + " '" + b.name + "' to TTOP: " + e.message.slice(0, 160)); }
        }
      }
    }
    // ---- Dhruva side: one execution, persisted like any other Dhruva change ----
    const dhWork = Object.entries(work).filter(([, w]) => w.dhRename.length || w.dhAdd.length);
    if (dhWork.length) {
      const r = await runtime.run("portal", null, null, {
        run: (c) => {
          const ss = c.sandbox.SpreadsheetApp.openById(CONTROL_WB);
          for (const [kind, w] of dhWork) {
            const sh = ss.getSheetByName(KINDS[kind].tab);
            for (const x of w.dhRename) {
              const cur = String(sh.getRange(x.row, 1).getValue() || "").trim();
              if (cur === x.id) { sh.getRange(x.row, 2).setValue(x.to); x.done = true; }
            }
            if (w.dhAdd.length) {
              const start = sh.getLastRow() + 1;
              sh.getRange(start, 1, w.dhAdd.length, 2).setValues(w.dhAdd.map(a => [a.id, a.name]));
            }
          }
          return null;
        }
      });
      try { await r.persisted; } catch (e) { plan.errors.push("Saving Dhruva master changes failed: " + e.message); }
      if (!r.ok) plan.errors.push("Dhruva master update failed: " + (r.error && r.error.message));
      else for (const [kind, w] of dhWork) {
        for (const a of w.dhAdd) w.linkUpsert.push({ kind, dhruva_id: a.id, entity_id: a.entity_id, ttop_name: a.name, dhruva_name: a.name });
        for (const x of w.dhRename) if (x.done) w.linkUpsert.push(x.link);
      }
    }
    // ---- links ----
    for (const kind of Object.keys(work)) {
      const w = work[kind];
      const seen = new Map();
      for (const l of w.linkUpsert) seen.set(l.dhruva_id, l);
      const rows = [...seen.values()].map(l => ({ kind: l.kind, dhruva_id: l.dhruva_id, entity_id: l.entity_id, ttop_name: l.ttop_name, dhruva_name: l.dhruva_name, updated_at: new Date().toISOString() }));
      for (let i = 0; i < rows.length; i += 500) await rest("POST", "app_master_links?on_conflict=kind,dhruva_id", rows.slice(i, i + 500), { Prefer: "resolution=merge-duplicates,return=minimal" });
      for (const id of w.linkDelete) await rest("DELETE", "app_master_links?kind=eq." + kind + "&dhruva_id=eq." + encodeURIComponent(id), undefined, { Prefer: "return=minimal" });
    }
    const changed = Object.values(work).some(w => w.ttAdd.length || w.ttRename.length || w.dhAdd.length || w.dhRename.length);
    if (changed) log.log("[masters] synced: " + JSON.stringify({ candidate: pick(plan.candidate), client: pick(plan.client), errors: plan.errors.length }));
    lastReport = plan;
    return plan;
  }
  const pick = (p) => p && { addToTtop: p.addToTtop, addToDhruva: p.addToDhruva, renameInTtop: p.renameInTtop, renameInDhruva: p.renameInDhruva };

  /** One sync pass (cron every minute, right after a Dhruva master change, or when asked). */
  function tick() {
    if (running) return running;
    running = (async () => {
      try {
        const m = await getMode();
        lastTick = Date.now();
        return m !== "off" ? await reconcile(m === "on") : null;
      } catch (e) { log.error("[masters] sync failed: " + (e && e.message)); return null; }
      finally {
        running = null;
        if (again) { again = false; tick(); }   // a change arrived while this pass was running
      }
    })();
    return running;
  }
  /** Called after Dhruva changes are saved: sync now if a master tab changed. */
  function onDhruvaChanges(changes) {
    for (const sd of changes.sheets.keys()) {
      if (sd.workbook && sd.workbook.id === CONTROL_WB && (sd.name === "Candidate Master" || sd.name === "Client Master")) {
        if (running) { again = true; return null; }   // never wait on a pass that is waiting on us
        return tick();
      }
    }
    return null;
  }
  /** Sync if it has not run for a while (in case the once-a-minute schedule is not set up). */
  function tickIfStale(ms) { return Date.now() - lastTick > (ms || 120000) ? tick() : null; }

  return { tick, tickIfStale, reconcile, setMode, getMode, onDhruvaChanges, report: () => lastReport, mode: () => mode };
}

module.exports = { createMasters, nameKey, clientKey };
