/* ============================================================
   TTOP – drive.js
   The single seam between the portal and Google Drive / Sheets.

   LIVE ONLY: every upload is POSTed to the Apps Script web app
   (apps-script/Code.gs), which saves the file into Drive and
   returns the real link.  There is no simulated/demo mode — if an
   upload or sync fails, the user sees the real error.

   The connection below is the built-in default. It can be
   overridden in Settings → Google Drive & Sheets.
   ============================================================ */

const Drive = (() => {

  const MAX_BYTES = 20 * 1024 * 1024; // Apps Script request payload is limited; 20 MB is a safe ceiling

  // Built-in connection (must match SECRET in the deployed Code.gs)
  const DEFAULT_ENDPOINT = "https://script.google.com/macros/s/AKfycbykuR22KMQhBMuRD4xa6atGWyzXgP5asYvel6vUFj06Qj06nI7RrsWm7WFzJN4I6gJA/exec";
  const DEFAULT_SECRET = "CandidateAssessmentsTracker";

  function config() {
    const s = Storage.getSettings();
    return {
      endpoint: (s.driveEndpoint || "").trim() || DEFAULT_ENDPOINT,
      secret: (s.driveSecret || "").trim() || DEFAULT_SECRET
    };
  }
  function isLive() { return !!config().endpoint; }

  function readAsBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1] || "");
      r.onerror = () => reject(new Error("Could not read the file."));
      r.readAsDataURL(file);
    });
  }

  /**
   * @param {object} payload
   * @param {{throwOnError?: boolean}} opts  throwOnError=false returns the (possibly ok:false) JSON
   *   instead of throwing — used for sign-in calls, where "pending"/"rejected" is an expected outcome.
   */
  async function request(payload, opts = {}) {
    const throwOnError = opts.throwOnError !== false;
    const { endpoint, secret } = config();
    const body = { ...payload, secret };
    const token = typeof Auth !== "undefined" ? Auth.getToken() : "";
    if (token) body.sessionToken = token;

    // text/plain keeps this a "simple" request so the browser skips the CORS preflight Apps Script can't answer
    let res;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body)
      });
    } catch (e) {
      const msg = "Could not reach Google Drive. Check your internet connection and that the Apps Script is deployed with access set to \"Anyone\".";
      if (!throwOnError) return { ok: false, error: msg };
      throw new Error(msg);
    }
    if (!res.ok) {
      if (!throwOnError) return { ok: false, error: `Drive service returned ${res.status}` };
      throw new Error(`Drive service returned ${res.status}`);
    }
    let json;
    try { json = await res.json(); }
    catch (e) {
      const msg = "Google returned an unexpected response. Redeploy the Apps Script (Execute as: Me, Access: Anyone) and try again.";
      if (!throwOnError) return { ok: false, error: msg };
      throw new Error(msg);
    }
    if (!json.ok) {
      if (json.authRequired && typeof Auth !== "undefined") Auth.signOut(); // session expired/revoked: show the sign-in gate again
      if (!throwOnError) return json;
      throw new Error(json.error === "Unauthorized" ? "Google Drive rejected the secret — it must match SECRET in Code.gs." : (json.error || "Drive service reported an error."));
    }
    return json;
  }

  async function post(payload) { return request(payload, { throwOnError: true }); }
  async function postRaw(payload) { return request(payload, { throwOnError: false }); }

  /**
   * Upload one file.
   * @param {File} file
   * @param {{candidate:string, client:string, assessmentType:string, field:string}} meta
   * @returns {Promise<{name:string,size:number,url:string,folderUrl:string,uploadedAt:string}>}
   */
  async function upload(file, meta) {
    if (file.size > MAX_BYTES) throw new Error(`"${file.name}" is ${Utils.formatFileSize(file.size)} — the limit is ${Utils.formatFileSize(MAX_BYTES)}.`);
    const base = { name: file.name, size: file.size, uploadedAt: new Date().toISOString() };

    const data = await readAsBase64(file);
    const out = await post({
      action: "upload", fileName: file.name, mimeType: file.type || "application/octet-stream", data,
      candidate: meta.candidate, client: meta.client, assessmentType: meta.assessmentType, field: meta.field
    });
    return { ...base, id: out.id, url: out.url, folderUrl: out.folderUrl || "" };
  }

  return { isLive, config, upload, call: post, callRaw: postRaw, MAX_BYTES, DEFAULT_ENDPOINT, DEFAULT_SECRET };
})();
