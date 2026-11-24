"use strict";
/**
 * Worker thread for long-running executions (incentive scan, bulk approvals…).
 *
 * In Google, executions run in parallel; Node runs JavaScript on one thread.
 * So long operations run here, on a snapshot of the data, while the main
 * thread keeps serving the portal. Changed rows are sent back and merged
 * (row-level, like concurrent Apps Script executions). CacheService writes
 * (operation progress) and script-lock state are mirrored to the main thread
 * live so progress polling and lock contention behave as before.
 */
process.env.TZ = process.env.TZ || "Asia/Kolkata";
const { parentPort, workerData } = require("worker_threads");
const { Store } = require("./store");
const { Runtime } = require("./runtime");
const S = require("./gas/services");
const { snapshotToStore, changesToTransfer } = require("./snapshot");

const runtime = new Runtime({
  store: new Store(), config: workerData.config, appsScriptDir: workerData.appsScriptDir,
  publicUrl: workerData.publicUrl, ownerEmail: workerData.ownerEmail, timeZone: workerData.timeZone,
  adapter: null, mailer: async () => {}, logger: console
});
runtime.loadProjects();

// mirror cache writes to the main thread
const origCacheMap = S.CACHES;
const mirror = (ns, key, entry) => parentPort.postMessage({ type: "cache", ns, key, entry });
function wrapCacheMaps() {
  for (const [ns, m] of origCacheMap) hook(ns, m);
}
function hook(ns, m) {
  if (m.__hooked) return;
  const set = m.set.bind(m), del = m.delete.bind(m);
  m.set = (k, v) => { mirror(ns, k, v); return set(k, v); };
  m.delete = (k) => { mirror(ns, k, null); return del(k); };
  m.__hooked = true;
}

parentPort.on("message", (job) => {
  if (job.type !== "run") return;
  const store = new Store();
  snapshotToStore(job.snapshot, store);
  // mirror Script Properties writes live (job status/progress is polled from the portal)
  const hookProps = (ns, m) => {
    if (m.__hooked) return m;
    const set = m.set.bind(m), del = m.delete.bind(m);
    m.set = (k, v) => { parentPort.postMessage({ type: "prop", ns, key: k, value: v }); return set(k, v); };
    m.delete = (k) => { parentPort.postMessage({ type: "prop", ns, key: k, value: null }); return del(k); };
    m.__hooked = true;
    return m;
  };
  for (const [ns, m] of store.props) hookProps(ns, m);
  const baseProps = store.properties.bind(store);
  store.properties = (ns) => hookProps(ns, baseProps(ns));
  runtime.store = store;
  // fresh cache view seeded from main
  origCacheMap.clear();
  for (const [ns, entries] of Object.entries(job.cache || {})) {
    const m = new Map(entries);
    origCacheMap.set(ns, m);
  }
  // any cache namespace created during the job is hooked as well
  const setNs = origCacheMap.set.bind(origCacheMap);
  origCacheMap.set = (ns, m) => { hook(ns, m); return setNs(ns, m); };
  wrapCacheMaps();
  const lockState = (held) => parentPort.postMessage({ type: "lock", project: job.project, held });
  const r = runtime.execute(job.project, job.fn, job.argsJson, {
    transform: job.serialize ? (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v === undefined ? null : v))) : undefined,
    activeUserEmail: job.activeUserEmail,
    prepare: (c) => {
      const L = c.sandbox.LockService;
      const wrap = (make) => () => {
        const l = make();
        return {
          tryLock: (ms) => { lockState(true); return l.tryLock(ms); },
          waitLock: (ms) => { lockState(true); return l.waitLock(ms); },
          releaseLock: () => { lockState(false); return l.releaseLock(); },
          hasLock: () => l.hasLock()
        };
      };
      c.sandbox.LockService = { getScriptLock: wrap(L.getScriptLock), getUserLock: L.getUserLock, getDocumentLock: wrap(L.getDocumentLock) };
    },
    keepJournal: true
  });
  lockState(false);
  origCacheMap.set = setNs;
  parentPort.postMessage({
    type: "done",
    ok: r.ok, value: r.value,
    error: r.error ? { name: r.error.name, message: String(r.error.message !== undefined ? r.error.message : r.error), stack: String(r.error.stack || "") } : null,
    logs: r.logs, mails: r.mails,
    changes: changesToTransfer(r.changes)
  });
});
