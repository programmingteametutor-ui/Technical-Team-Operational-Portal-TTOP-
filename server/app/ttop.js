"use strict";
/**
 * Serves the TTOP portal unchanged.
 *  - The page (portals/ttop/index.html) is served at /ttop/.
 *  - TTOP refers to /api/config, /manifest.json, /sw.js and /icons/... from the site root,
 *    so those are served at the root, exactly as on Vercel (with vercel.json's headers).
 *  - TTOP's Vercel functions (api/*.js) run here through a tiny Vercel-style adapter:
 *      /api/config, /api/sync-doc, /api/push-alerts,
 *      /api/interview-inbox, /api/interview-inbox/refresh,
 *      /api/interview-inbox/:id, /api/interview-inbox/:id/dismiss
 */
const fs = require("fs");
const path = require("path");

function createTtop({ root, log }) {
  const dir = path.join(root, "portals", "ttop");
  const NO_CACHE = "no-cache, must-revalidate";
  const TYPES = { ".png": "image/png", ".json": "application/json", ".js": "application/javascript; charset=utf-8", ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

  function sendFile(res, file, headers) {
    let data;
    try { data = fs.readFileSync(file); } catch (e) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
    res.writeHead(200, Object.assign({ "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" }, headers || {}));
    res.end(data);
  }

  /** Static routes. Returns true when handled. */
  function serveStatic(req, res, p) {
    if (p === "/ttop" || p === "/ttop/" || p === "/ttop/index.html") { sendFile(res, path.join(dir, "index.html"), { "Cache-Control": NO_CACHE }); return true; }
    if (p === "/manifest.json") { sendFile(res, path.join(dir, "manifest.json"), { "Cache-Control": NO_CACHE, "Content-Type": "application/manifest+json" }); return true; }
    if (p === "/sw.js") { sendFile(res, path.join(dir, "sw.js"), { "Cache-Control": NO_CACHE, "Service-Worker-Allowed": "/" }); return true; }
    const m = /^\/icons\/([\w.-]+)$/.exec(p);
    if (m) { sendFile(res, path.join(dir, "icons", m[1]), { "Cache-Control": "public, max-age=86400" }); return true; }
    return false;
  }

  /* -------------------- Vercel function adapter -------------------- */
  const ROUTES = [
    [/^\/api\/config(?:\.js)?$/, "api/config.js", []],
    [/^\/api\/sync-doc$/, "api/sync-doc.js", []],
    [/^\/api\/push-alerts$/, "api/push-alerts.js", []],
    [/^\/api\/interview-inbox$/, "api/interview-inbox/index.js", []],
    [/^\/api\/interview-inbox\/refresh$/, "api/interview-inbox/refresh.js", []],
    [/^\/api\/interview-inbox\/([^/]+)\/dismiss$/, "api/interview-inbox/[id]/dismiss.js", ["id"]],
    [/^\/api\/interview-inbox\/([^/]+)$/, "api/interview-inbox/[id].js", ["id"]]
  ];
  function matchApi(p) {
    for (const [re, file, names] of ROUTES) {
      const m = re.exec(p);
      if (m) return { file: path.join(dir, file), params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  }

  async function serveApi(req, res, p, readBody) {
    const route = matchApi(p);
    if (!route) return false;
    let handler;
    try { handler = require(route.file); }
    catch (e) {
      const missing = /Cannot find module '([^']+)'/.exec(e.message);
      log.error("[ttop] cannot load " + route.file + ": " + e.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: missing ? "Server package '" + missing[1] + "' is not installed. Run npm install." : "Server error" }));
      return true;
    }
    const u = new URL(req.url, "http://x");
    // (on Vercel with its request helpers on, query/body may already be getters: replace them safely)
    const setProp = (o, k, v) => { try { Object.defineProperty(o, k, { value: v, writable: true, configurable: true, enumerable: true }); } catch (e) { try { o[k] = v; } catch (_) {} } };
    setProp(req, "query", Object.assign({}, Object.fromEntries(u.searchParams), route.params));
    if (req.method !== "GET" && req.method !== "HEAD") {
      const raw = await readBody(req);
      const ct = String(req.headers["content-type"] || "");
      let body;
      if (/json/.test(ct)) { try { body = raw ? JSON.parse(raw) : {}; } catch (e) { body = raw; } }
      else if (/x-www-form-urlencoded/.test(ct)) body = Object.fromEntries(new URLSearchParams(raw));
      else body = raw;
      setProp(req, "body", body);
    }
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(o)); return res; };
    res.send = (b) => {
      if (b !== null && typeof b === "object" && !Buffer.isBuffer(b)) return res.json(b);
      if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(b === undefined ? "" : b); return res;
    };
    res.redirect = (a, b) => { const [code, loc] = typeof a === "number" ? [a, b] : [307, a]; res.writeHead(code, { Location: loc }); res.end(); return res; };
    try {
      await handler(req, res);
    } catch (e) {
      log.error("[ttop] " + p + " failed: " + (e && e.stack || e));
      if (!res.headersSent) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "Server error" })); }
    }
    return true;
  }

  return { serveStatic, serveApi, dir };
}

module.exports = { createTtop };
