/*
 * google.script.* for the portal page outside Google Apps Script.
 * Same API as Apps Script's client: google.script.run.withSuccessHandler(fn)
 * .withFailureHandler(fn).withUserObject(obj).serverFunction(args...)
 * Calls go to POST /api/run on the portal server.
 */
(function () {
  "use strict";
  if (window.google && window.google.script && window.google.script.__supabaseRuntime) return;

  /* ---- Combined app: single sign-on into the Dhruva portal ----
   * The portal keeps its own session token in localStorage. Before the portal's own
   * scripts run, make sure that token belongs to the person signed in to the app
   * (one synchronous request, so the portal boots already signed in). */
  var TOKEN_KEY = "interview_portal_session";
  var HOME = "/?next=" + encodeURIComponent("/dhruva/");
  function ssoSync() {
    var cur = "";
    try { cur = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || ""; } catch (e) {}
    try {
      var x = new XMLHttpRequest();
      x.open("GET", "/app/api/dhruva-session?current=" + encodeURIComponent(cur), false);
      x.send(null);
      var j = {}; try { j = JSON.parse(x.responseText || "{}"); } catch (e) {}
      if (x.status === 200 && j.token) {
        try { if (j.token !== cur) { localStorage.setItem(TOKEN_KEY, j.token); sessionStorage.removeItem(TOKEN_KEY); } } catch (e) {}
        return true;
      }
      if (x.status === 401) { location.replace(HOME); return false; }
      alert(j.error || "You cannot open the Dhruva portal.");
      location.replace("/");
      return false;
    } catch (e) { return true; }
  }
  var IS_DHRUVA_PAGE = /^\/dhruva\/?$/.test(location.pathname);
  if (IS_DHRUVA_PAGE) ssoSync();

  function serializeArg(a) {
    // Apps Script turns <form> elements into an object of field values
    if (typeof HTMLFormElement !== "undefined" && a instanceof HTMLFormElement) {
      var o = {};
      Array.prototype.forEach.call(a.elements, function (el) {
        if (!el.name || el.disabled) return;
        if ((el.type === "checkbox" || el.type === "radio") && !el.checked) return;
        o[el.name] = el.value;
      });
      return o;
    }
    return a;
  }

  function call(fn, args, success, failure, userObject) {
    var body;
    try {
      body = JSON.stringify({ fn: fn, args: Array.prototype.map.call(args, serializeArg) });
    } catch (e) {
      setTimeout(function () { if (failure) failure(e, userObject); }, 0);
      return;
    }
    fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: body, credentials: "same-origin" })
      .then(function (r) {
        return r.text().then(function (t) {
          try { return JSON.parse(t); }
          catch (e) { return { ok: false, error: { name: "NetworkError", message: "Server returned an unexpected response (" + r.status + ")." } }; }
        });
      })
      .then(function (res) {
        if (res && !res.ok && res.error && res.error.name === "AppAuth") {
          // app session ended or access removed: back to the home page
          location.href = res.error.message === "APP_SIGNED_OUT" ? HOME : "/";
          return;
        }
        if (res && !res.ok && res.error && res.error.message === "SESSION_EXPIRED" && IS_DHRUVA_PAGE) {
          // Dhruva session ended while the app session is still valid: sign in again silently, once
          var k = "iop_resso", n = 0; try { n = Number(sessionStorage.getItem(k) || 0); } catch (e) {}
          if (n < 2) { try { sessionStorage.setItem(k, String(n + 1)); } catch (e) {} if (ssoSync()) { location.reload(); return; } }
        } else if (res && res.ok) { try { sessionStorage.removeItem("iop_resso"); } catch (e) {} }
        if (res && res.ok && fn === "logoutPortal") {
          // signing out of Dhruva signs out of the app (Google sign-in) too
          setTimeout(function () { location.href = "/?signout=1"; }, 50);
        }
        if (res && res.ok) {
          if (success) success(res.undef ? undefined : res.value, userObject);
        } else {
          var err = new Error(res && res.error && res.error.message !== undefined ? res.error.message : "Unknown error");
          err.name = (res && res.error && res.error.name) || "ScriptError";
          if (failure) failure(err, userObject);
          else if (window.console) console.error(err);
        }
      }, function (netErr) {
        var err = new Error("NetworkError: Connection failure due to HTTP 0");
        err.name = "NetworkError";
        if (failure) failure(err, userObject);
      });
  }

  function makeRunner(success, failure, userObject) {
    var base = {
      withSuccessHandler: function (fn) { return makeRunner(fn, failure, userObject); },
      withFailureHandler: function (fn) { return makeRunner(success, fn, userObject); },
      withUserObject: function (obj) { return makeRunner(success, failure, obj); }
    };
    return new Proxy(base, {
      get: function (target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop !== "string" || prop === "then") return undefined;
        return function () { call(prop, arguments, success, failure, userObject); };
      }
    });
  }

  function location() {
    var params = {}, parameters = {};
    new URLSearchParams(window.location.search).forEach(function (v, k) {
      if (!(k in params)) params[k] = v;
      (parameters[k] = parameters[k] || []).push(v);
    });
    return { hash: window.location.hash.replace(/^#/, ""), parameter: params, parameters: parameters };
  }

  window.google = window.google || {};
  window.google.script = {
    __supabaseRuntime: true,
    run: makeRunner(null, null, undefined),
    url: { getLocation: function (cb) { setTimeout(function () { cb(location()); }, 0); } },
    history: {
      push: function (state, params, hash) { history.pushState(state, "", buildUrl(params, hash)); },
      replace: function (state, params, hash) { history.replaceState(state, "", buildUrl(params, hash)); },
      setChangeHandler: function (fn) { window.addEventListener("popstate", function (e) { fn({ state: e.state, location: location() }); }); }
    },
    host: {
      origin: window.location.origin,
      close: function () { window.close(); },
      setHeight: function () {}, setWidth: function () {},
      editor: { focus: function () {} }
    }
  };
  function buildUrl(params, hash) {
    var q = params ? "?" + new URLSearchParams(params).toString() : window.location.search;
    return window.location.pathname + q + (hash ? "#" + hash : "");
  }
})();
