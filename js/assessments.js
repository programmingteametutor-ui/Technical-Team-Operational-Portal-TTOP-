/* ============================================================
   TTOP – assessments.js
   Assessment records table + Add/Edit modal + type-aware file
   fields (Take Home / Portal / Coding Assessment), each with a
   Drive-link box AND a file-upload button (see drive.js; uploads are live to Google Drive), file
   upload required once the status moves past "Assessment Pending",
   + duplicate detection.

   Task Files and Solution Files accept MULTIPLE files/links (stored as
   an array of { url, upload? }); every other field is a single link.
   Older records that stored one link string are read transparently.

   There is no "Done By" on an assessment any more — the Tool Drive
   person is recorded on the interview.
   ============================================================ */

const Assessments = (() => {

  const STATUS_OPTIONS = ["Assessment Pending", "Assessment Completed", "Ongoing Interview", "Upcoming Interview", "Interview Completed"];
  const TYPE_OPTIONS = ["Take Home", "Portal", "Coding Assessment"];

  /**
   * Files that MUST be uploaded (not just linked) before an assessment
   * can leave "Assessment Pending". Resume / JD / Script stay optional.
   * Change these lists to change the rule.
   */
  const REQUIRED_ON_COMPLETE = {
    "Take Home": ["taskFiles", "solutionFiles"],
    "Portal": ["completionScreenshot"],
    "Coding Assessment": ["screenshot", "codingDoc", "solutionFiles"]
  };
  const isCompletedStatus = status => status !== "Assessment Pending";

  /** Fields that hold a LIST of files/links instead of a single one */
  const MULTI_FIELDS = ["taskFiles", "solutionFiles"];
  const isMulti = key => MULTI_FIELDS.includes(key);
  let itemSeq = 0;
  const newItem = (extra = {}) => ({ id: `i${++itemSeq}`, url: "", ...extra });

  /** Normalise a saved record's value for a multi field into [{url, upload?}] (handles legacy single-link strings) */
  function itemsFromRecord(record, key) {
    const v = record?.[key];
    if (Array.isArray(v)) return v.filter(x => x && x.url).map(x => ({ url: x.url, upload: x.upload }));
    if (typeof v === "string" && v) {
      const up = record.uploads?.[key];
      return [{ url: v, upload: up && up.url === v ? up : undefined }];
    }
    return [];
  }

  let state = {
    page: 1, pageSize: 6, sortKey: "date", sortDir: "desc", search: "", filters: {},
    editingId: null, pendingDuplicateOverride: false,
    files: {},        // per-modal: { fieldKey: { url, upload? } }
    uploading: 0, session: 0, onSaved: null
  };

  /** Tool Drive person for an assessment = the linked interview's "Done By" (legacy assessment.doneBy as fallback) */
  function getToolDrive(a) {
    const ivs = Storage.getAll("interviews");
    const linked = ivs.find(i => i.assessmentId === a.id && i.doneBy) ||
      ivs.find(i => i.candidateName === a.candidateName && i.client === a.client && i.doneBy);
    return linked?.doneBy || a.doneBy || "";
  }

  /* ------------------------- Table ------------------------- */

  function getFilteredSorted() {
    let rows = Storage.getAll("assessments");
    if (state.search) {
      const q = state.search.toLowerCase();
      rows = rows.filter(r => `${r.candidateName} ${r.client} ${r.techRole}`.toLowerCase().includes(q));
    }
    const f = state.filters;
    if (f.type) rows = rows.filter(r => r.type === f.type);
    if (f.status) rows = rows.filter(r => r.status === f.status);
    if (f.client) rows = rows.filter(r => r.client === f.client);

    rows.sort((a, b) => {
      const va = (a[state.sortKey] || "").toString();
      const vb = (b[state.sortKey] || "").toString();
      return state.sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    });
    return rows;
  }

  function renderTable() {
    const all = getFilteredSorted();
    const totalPages = Math.max(1, Math.ceil(all.length / state.pageSize));
    state.page = Math.min(state.page, totalPages);
    const start = (state.page - 1) * state.pageSize;
    const pageRows = all.slice(start, start + state.pageSize);

    const tbody = document.getElementById("assessmentsTableBody");
    if (tbody) {
      tbody.innerHTML = pageRows.map(r => `
        <tr data-id="${r.id}">
          <td data-label="Date">${Utils.formatDate(r.date)}</td>
          <td data-label="Type"><span class="pill">${r.type}</span></td>
          <td data-label="Candidate"><strong>${Utils.escapeHtml(r.candidateName)}</strong></td>
          <td data-label="Tech/Role">${Utils.escapeHtml(r.techRole)}</td>
          <td data-label="Interview Date">${r.interviewDate ? Utils.formatDate(r.interviewDate) : "—"}</td>
          <td data-label="Client">${Utils.escapeHtml(r.client)}</td>
          <td data-label="Status"><span class="badge ${Utils.statusBadgeClass(r.status)}">${r.status}</span></td>
          <td data-label="Folder">${r.folderLink ? `<a href="${Utils.escapeHtml(r.folderLink)}" target="_blank" rel="noopener" class="link-chip">📁 Open</a>` : "—"}</td>
          <td class="row-actions" data-label="Actions">
            <button class="icon-btn" data-action="view" title="View">👁️</button>
            <button class="icon-btn" data-action="edit" title="Edit">✏️</button>
            <button class="icon-btn icon-btn--danger" data-action="delete" title="Delete">🗑️</button>
          </td>
        </tr>`).join("") || `<tr><td colspan="9" class="empty-hint">No assessments match your search/filters.</td></tr>`;
    }

    const pager = document.getElementById("assessmentsPager");
    if (pager) {
      pager.innerHTML = `
        <button class="btn btn--ghost" ${state.page <= 1 ? "disabled" : ""} data-page="prev">‹ Prev</button>
        <span class="pager__info">Page ${state.page} of ${totalPages} · ${all.length} records</span>
        <button class="btn btn--ghost" ${state.page >= totalPages ? "disabled" : ""} data-page="next">Next ›</button>`;
    }
  }

  function populateFilterOptions() {
    const rows = Storage.getAll("assessments");
    const clientSel = document.getElementById("asFilterClient");
    if (clientSel) {
      const clients = [...new Set(rows.map(r => r.client))];
      const keep = clientSel.value;
      clientSel.innerHTML = `<option value="">All Clients</option>` + clients.map(c => `<option value="${Utils.escapeHtml(c)}">${Utils.escapeHtml(c)}</option>`).join("");
      if (clients.includes(keep)) clientSel.value = keep;
    }
  }

  function bindTableEvents() {
    document.getElementById("assessmentSearch")?.addEventListener("input", Utils.debounce(e => {
      state.search = e.target.value; state.page = 1; renderTable();
    }, 200));

    ["asFilterType", "asFilterStatus", "asFilterClient"].forEach(id => {
      document.getElementById(id)?.addEventListener("change", e => {
        state.filters[id === "asFilterType" ? "type" : id === "asFilterStatus" ? "status" : "client"] = e.target.value;
        state.page = 1; renderTable();
      });
    });

    document.getElementById("asClearFilters")?.addEventListener("click", () => {
      state.filters = {}; state.search = "";
      document.querySelectorAll("#assessmentsFilterBar select, #assessmentsFilterBar input").forEach(el => el.value = "");
      renderTable();
    });

    document.querySelectorAll("#assessmentsTable th[data-sort]").forEach(th => {
      th.addEventListener("click", () => {
        const key = th.dataset.sort;
        state.sortDir = state.sortKey === key && state.sortDir === "desc" ? "asc" : "desc";
        state.sortKey = key;
        renderTable();
      });
    });

    document.getElementById("assessmentsPager")?.addEventListener("click", e => {
      const btn = e.target.closest("button[data-page]");
      if (!btn) return;
      if (btn.dataset.page === "prev") state.page--; else state.page++;
      renderTable();
    });

    document.getElementById("assessmentsTableBody")?.addEventListener("click", async e => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const id = btn.closest("tr").dataset.id;
      if (btn.dataset.action === "view") openViewModal(id);
      if (btn.dataset.action === "edit") openModal(id);
      if (btn.dataset.action === "delete") {
        const ok = await Utils.confirmDialog("Delete this assessment?", "Are you sure you want to delete this record? This cannot be undone.");
        if (ok) {
          Storage.remove("assessments", id);
          Storage.logActivity(`An assessment record was deleted`, "🗑️");
          renderTable();
          Dashboard.renderAll();
          Utils.toast("Assessment deleted.", "success");
        }
      }
    });

    document.getElementById("btnAddAssessment")?.addEventListener("click", () => openModal(null));
  }

  /* ------------------------- Modal ------------------------- */

  function fieldsForType(type) {
    if (type === "Portal") return ["completionScreenshot", "folderLink"];
    if (type === "Coding Assessment") return ["screenshot", "codingDoc", "solutionFiles", "folderLink"];
    return ["resume", "jd", "taskFiles", "solutionFiles", "scriptFile", "folderLink"]; // Take Home
  }

  const FIELD_LABELS = {
    resume: "Resume", jd: "JD", taskFiles: "Task Files", solutionFiles: "Solution Files", scriptFile: "Script File",
    completionScreenshot: "Completion Screenshot",
    screenshot: "Screenshot", codingDoc: "Coding Assessment Document", folderLink: "Folder Link"
  };

  function chipHTML(key) {
    const f = state.files[key];
    if (f?.uploading) return `<div class="upload-chip upload-chip--busy">⏳ Uploading <strong>${Utils.escapeHtml(f.uploading)}</strong>…</div>`;
    if (!f?.upload) return "";
    const u = f.upload;
    return `<div class="upload-chip upload-chip--ok">
      📎 <strong>${Utils.escapeHtml(u.name)}</strong> <span>${Utils.formatFileSize(u.size)}</span>
      <span>· ✓ Saved to Google Drive</span>
      <button type="button" class="upload-chip__remove" data-remove="${key}" title="Remove this file">✕</button>
    </div>`;
  }

  /** Items for a multi field; always at least one (blank) row so a link can be pasted straight away */
  function ensureItems(key) {
    if (!Array.isArray(state.files[key])) state.files[key] = [];
    if (!state.files[key].length) state.files[key].push(newItem());
    return state.files[key];
  }

  function itemRowHTML(key, it) {
    if (it.uploading) return `<div class="upload-chip upload-chip--busy">⏳ Uploading <strong>${Utils.escapeHtml(it.uploading)}</strong>…</div>`;
    if (it.upload) {
      const u = it.upload;
      return `<div class="upload-chip upload-chip--ok" data-item-row="${it.id}">
        📎 <strong>${Utils.escapeHtml(u.name)}</strong> <span>${Utils.formatFileSize(u.size)}</span>
        <span>· ✓ Saved to Google Drive</span>
        <span class="upload-chip__btns">
          <button type="button" class="btn btn--ghost btn--sm" data-item-open="${it.id}">Open</button>
          <button type="button" class="btn btn--ghost btn--sm" data-item-copy="${it.id}">Copy</button>
          <button type="button" class="upload-chip__remove" data-item-remove="${it.id}" title="Remove this file">✕</button>
        </span>
      </div>`;
    }
    return `<div class="drivelink multi-item" data-item-row="${it.id}">
      <input type="url" data-item="${it.id}" placeholder="Paste a Drive link…" value="${Utils.escapeHtml(it.url || "")}">
      <button type="button" class="btn btn--ghost btn--sm" data-item-open="${it.id}">Open</button>
      <button type="button" class="btn btn--ghost btn--sm" data-item-copy="${it.id}">Copy</button>
      <button type="button" class="btn btn--ghost btn--sm" data-item-remove="${it.id}" title="Remove this link">✕</button>
    </div>`;
  }

  function multiListHTML(key) {
    return ensureItems(key).map(it => itemRowHTML(key, it)).join("");
  }

  function renderFileFields(type) {
    return fieldsForType(type).map(key => {
      if (isMulti(key)) {
        return `
      <div class="form-group form-group--drivelink" data-field="${key}">
        <label>${FIELD_LABELS[key]}<span class="req-mark" hidden> *</span> <span class="muted multi-hint">— you can add multiple files</span></label>
        <div class="multi-actions">
          <button type="button" class="btn btn--secondary btn--sm" data-upload="${key}">⬆️ Upload files</button>
          <input type="file" multiple hidden data-file="${key}">
          <button type="button" class="btn btn--ghost btn--sm" data-addlink="${key}">＋ Add link</button>
        </div>
        <div class="multi-list" data-chip="${key}">${multiListHTML(key)}</div>
      </div>`;
      }
      const canUpload = key !== "folderLink";
      return `
      <div class="form-group form-group--drivelink" data-field="${key}">
        <label>${FIELD_LABELS[key]}<span class="req-mark" hidden> *</span></label>
        <div class="drivelink">
          <input type="url" name="${key}" placeholder="${canUpload ? "Paste a Drive link, or upload a file →" : "https://drive.google.com/... (auto-filled on upload)"}" value="${Utils.escapeHtml(state.files[key]?.url || "")}">
          ${canUpload ? `<button type="button" class="btn btn--secondary btn--sm" data-upload="${key}">⬆️ Upload</button>
          <input type="file" hidden data-file="${key}">` : ""}
          <button type="button" class="btn btn--ghost btn--sm" data-open="${key}">Open</button>
          <button type="button" class="btn btn--ghost btn--sm" data-copy="${key}">Copy</button>
        </div>
        <div data-chip="${key}">${chipHTML(key)}</div>
      </div>`;
    }).join("");
  }

  function rerenderFileFields() {
    const form = document.getElementById("assessmentForm");
    document.getElementById("assessmentFileFields").innerHTML = renderFileFields(form.elements.type.value);
    updateRequiredMarks();
  }

  function refreshChip(key) {
    const host = document.querySelector(`#assessmentFileFields [data-chip="${key}"]`);
    if (isMulti(key)) { if (host) host.innerHTML = multiListHTML(key); return; }
    if (host) host.innerHTML = chipHTML(key);
    const input = document.querySelector(`#assessmentFileFields input[name="${key}"]`);
    if (input) input.value = state.files[key]?.url || "";
  }

  function updateSubmitState() {
    const btn = document.querySelector('#assessmentForm button[type="submit"]');
    if (!btn) return;
    btn.disabled = state.uploading > 0;
    btn.textContent = state.uploading > 0 ? "Uploading…" : "Save Assessment";
  }

  /** Show a red * beside each file field that will be mandatory for the chosen status */
  function updateRequiredMarks() {
    const form = document.getElementById("assessmentForm");
    const required = isCompletedStatus(form.elements.status.value) ? REQUIRED_ON_COMPLETE[form.elements.type.value] || [] : [];
    document.querySelectorAll("#assessmentFileFields [data-field]").forEach(el => {
      el.querySelector(".req-mark").hidden = !required.includes(el.dataset.field);
      el.classList.remove("has-error");
    });
    const note = document.getElementById("uploadRequirementNote");
    if (note) {
      const names = required.map(k => FIELD_LABELS[k]).join(", ");
      note.hidden = !required.length;
      note.innerHTML = required.length ? `📎 Because the status is <strong>${Utils.escapeHtml(form.elements.status.value)}</strong>, these files must be <strong>uploaded</strong>: ${Utils.escapeHtml(names)}.` : "";
    }
  }

  /** A required field is satisfied by an uploaded file, or by a link that was already saved on this record before this edit */
  function isSatisfied(key, record) {
    if (isMulti(key)) {
      const items = (state.files[key] || []).filter(it => !it.uploading);
      if (items.some(it => it.upload)) return true;
      const saved = record ? itemsFromRecord(record, key).map(x => x.url) : [];
      return items.some(it => it.url && saved.includes(it.url));
    }
    const f = state.files[key];
    if (f?.upload) return true;
    return !!(record && record[key] && f?.url === record[key]);
  }

  /** Upload one file for a single-file field, or as a new list item for a multi field */
  async function uploadOne(key, file, meta, session) {
    const item = isMulti(key) ? newItem({ uploading: file.name }) : null;
    if (item) {
      state.files[key] = ensureItems(key).filter(it => it.url || it.upload || it.uploading); // drop blank placeholder rows
      state.files[key].push(item);
    } else {
      state.files[key] = { ...(state.files[key] || {}), uploading: file.name };
    }
    state.uploading++; updateSubmitState(); refreshChip(key);
    try {
      const up = await Drive.upload(file, { ...meta, field: FIELD_LABELS[key] });
      if (session !== state.session) return; // modal was closed/reopened meanwhile
      if (item) {
        if (state.files[key].includes(item)) { item.url = up.url; item.upload = up; item.uploading = null; } // ignore if removed meanwhile
      } else {
        state.files[key] = { url: up.url, upload: up };
      }
      if (up.folderUrl && !state.files.folderLink?.url) state.files.folderLink = { url: up.folderUrl };
      Utils.toast(`"${file.name}" uploaded to Google Drive.`, "success");
    } catch (err) {
      if (session !== state.session) return;
      if (item) state.files[key] = state.files[key].filter(it => it !== item);
      else state.files[key] = { ...(state.files[key] || {}), uploading: null };
      Utils.toast(err.message || "Upload failed.", "error", 5000);
    } finally {
      if (session === state.session) {
        state.uploading = Math.max(0, state.uploading - 1);
        updateSubmitState();
        ["folderLink", key].forEach(refreshChip);
        updateRequiredMarks();
      }
    }
  }

  async function handleFilesChosen(key, fileList) {
    const form = document.getElementById("assessmentForm");
    const candidate = form.elements.candidateName.value.trim();
    const client = form.elements.client.value.trim();
    if (!candidate || !client) {
      Utils.toast("Enter the candidate name and client first — the file is filed under them in Drive.", "warning");
      return;
    }
    const meta = { candidate, client, assessmentType: form.elements.type.value };
    const session = state.session;
    const files = isMulti(key) ? Array.from(fileList) : [fileList[0]];
    await Promise.all(files.map(f => uploadOne(key, f, meta, session)));
  }

  /**
   * @param {string|null} id  assessment to edit, or null to add
   * @param {{prefill?:object, onSaved?:function}} [opts]  prefill: candidateName/client/interviewDate/techRole;
   *   onSaved: called with the saved record (used by Add Interview to link the new assessment)
   */
  function openModal(id, opts = {}) {
    state.editingId = id;
    state.session++;
    state.uploading = 0;
    state.onSaved = opts.onSaved || null;
    const record = id ? Storage.find("assessments", id) : null;
    const pre = opts.prefill || {};
    const title = document.getElementById("assessmentModalTitle");
    if (title) title.textContent = id ? "Edit Assessment" : "Add Assessment";

    const form = document.getElementById("assessmentForm");
    form.reset();
    form.dataset.editingId = id || "";

    form.elements.date.value = record?.date || Utils.dateISO();
    form.elements.type.value = record?.type || "Take Home";
    form.elements.candidateName.value = record?.candidateName || pre.candidateName || "";
    form.elements.techRole.value = record?.techRole || pre.techRole || "";
    form.elements.interviewDate.value = record?.interviewDate || pre.interviewDate || "";
    form.elements.client.value = record?.client || pre.client || "";
    form.elements.status.value = record?.status || "Assessment Pending";
    const candList = document.getElementById("assessmentCandidateList");
    if (candList) candList.innerHTML = Storage.getAll("candidates").map(c => `<option value="${Utils.escapeHtml(c.name)}">`).join("");

    state.files = {};
    Object.keys(FIELD_LABELS).forEach(k => {
      if (isMulti(k)) { state.files[k] = itemsFromRecord(record, k).map(x => newItem(x)); return; }
      if (record?.[k] || record?.uploads?.[k]) state.files[k] = { url: record[k] || "", upload: record.uploads?.[k] && record.uploads[k].url === record[k] ? record.uploads[k] : undefined };
    });
    rerenderFileFields();
    updateSubmitState();
    document.getElementById("assessmentModalOverlay").classList.add("is-open");
  }

  function closeModal() {
    document.getElementById("assessmentModalOverlay").classList.remove("is-open");
    state.editingId = null;
    state.session++;       // discards any in-flight upload results
    state.uploading = 0;
    state.onSaved = null;
  }

  function fileChipView(r, k) {
    if (isMulti(k)) {
      const items = itemsFromRecord(r, k);
      if (!items.length) return "<em>Not provided</em>";
      return `<div class="multi-view">${items.map((it, i) => `<div><a href="${Utils.escapeHtml(it.url)}" target="_blank" rel="noopener" class="link-chip">📁 ${it.upload ? Utils.escapeHtml(it.upload.name) : `Link ${i + 1}`}</a></div>`).join("")}</div>`;
    }
    if (!r[k]) return "<em>Not provided</em>";
    const u = r.uploads?.[k];
    return `<a href="${Utils.escapeHtml(r[k])}" target="_blank" rel="noopener" class="link-chip">📁 ${u ? Utils.escapeHtml(u.name) : "Open"}</a>`;
  }

  function openViewModal(id) {
    const r = Storage.find("assessments", id);
    if (!r) return;
    const body = document.getElementById("viewModalBody");
    document.getElementById("viewModalTitle").textContent = `${r.candidateName} — Assessment`;
    const fileRows = fieldsForType(r.type).filter(k => k !== "folderLink").map(k =>
      `<div class="view-row"><span>${FIELD_LABELS[k]}</span><div>${fileChipView(r, k)}</div></div>`
    ).join("");
    body.innerHTML = `
      <div class="view-grid">
        <div class="view-row"><span>Date of Assessment</span><strong>${Utils.formatDate(r.date)}</strong></div>
        <div class="view-row"><span>Type</span><strong>${r.type}</strong></div>
        <div class="view-row"><span>Technology/Role</span><strong>${Utils.escapeHtml(r.techRole)}</strong></div>
        <div class="view-row"><span>Client</span><strong>${Utils.escapeHtml(r.client)}</strong></div>
        <div class="view-row"><span>Interview Date</span><strong>${r.interviewDate ? Utils.formatDate(r.interviewDate) : "—"}</strong></div>
        <div class="view-row"><span>Status</span><span class="badge ${Utils.statusBadgeClass(r.status)}">${r.status}</span></div>
        ${fileRows}
        <div class="view-row"><span>Folder Link</span>${r.folderLink ? `<a href="${Utils.escapeHtml(r.folderLink)}" target="_blank" rel="noopener" class="link-chip">📁 Open Folder</a>` : "<em>Not provided</em>"}</div>
      </div>`;
    document.getElementById("viewModalOverlay").classList.add("is-open");
  }

  function bindModalEvents() {
    document.getElementById("assessmentModalClose")?.addEventListener("click", closeModal);
    document.getElementById("assessmentModalCancel")?.addEventListener("click", closeModal);
    document.getElementById("viewModalClose")?.addEventListener("click", () => document.getElementById("viewModalOverlay").classList.remove("is-open"));

    const form = document.getElementById("assessmentForm");
    form?.elements.type.addEventListener("change", rerenderFileFields);
    form?.elements.status.addEventListener("change", updateRequiredMarks);

    const host = document.getElementById("assessmentFileFields");
    // typing/pasting a link: keep state in sync; replacing the link discards the "uploaded" badge
    host?.addEventListener("input", e => {
      const itemId = e.target.dataset.item;
      if (itemId) { // a pasted link inside a multi field
        const fieldKey = e.target.closest("[data-field]").dataset.field;
        const it = (state.files[fieldKey] || []).find(x => x.id === itemId);
        if (it) it.url = e.target.value.trim();
        updateRequiredMarks();
        return;
      }
      const key = e.target.name;
      if (!key || !FIELD_LABELS[key]) return;
      const cur = state.files[key] || {};
      state.files[key] = { url: e.target.value.trim(), upload: cur.upload && cur.upload.url === e.target.value.trim() ? cur.upload : undefined };
      if (cur.upload && !state.files[key].upload) refreshChip(key);
      updateRequiredMarks();
    });
    host?.addEventListener("change", e => {
      const key = e.target.dataset.file;
      if (!key || !e.target.files[0]) return;
      handleFilesChosen(key, e.target.files);
      e.target.value = "";
    });
    host?.addEventListener("click", e => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const { open: openKey, copy: copyKey, upload: uploadKey, remove: removeKey,
              addlink: addLinkKey, itemOpen, itemCopy, itemRemove } = btn.dataset;

      // ---- multi-field list actions
      if (addLinkKey) {
        ensureItems(addLinkKey).push(newItem());
        refreshChip(addLinkKey);
        const inputs = host.querySelectorAll(`[data-chip="${addLinkKey}"] input[data-item]`);
        inputs[inputs.length - 1]?.focus();
        return;
      }
      if (itemOpen || itemCopy || itemRemove) {
        const fieldKey = btn.closest("[data-field]").dataset.field;
        const id = itemOpen || itemCopy || itemRemove;
        const list = state.files[fieldKey] || [];
        const it = list.find(x => x.id === id);
        if (!it) return;
        if (itemRemove) { state.files[fieldKey] = list.filter(x => x !== it); refreshChip(fieldKey); updateRequiredMarks(); return; }
        if (!it.url) { Utils.toast("No link added yet.", "warning"); return; }
        if (itemCopy) { navigator.clipboard?.writeText(it.url); Utils.toast("Link copied.", "success"); return; }
        window.open(it.url, "_blank", "noopener");
        return;
      }

      if (uploadKey) host.querySelector(`input[data-file="${uploadKey}"]`)?.click();
      if (removeKey) { state.files[removeKey] = { url: "" }; refreshChip(removeKey); updateRequiredMarks(); }
      if (openKey) {
        const val = form.elements[openKey]?.value;
        if (!val) Utils.toast("No link added yet.", "warning");
        else window.open(val, "_blank", "noopener");
      }
      if (copyKey) {
        const val = form.elements[copyKey]?.value;
        if (val) { navigator.clipboard?.writeText(val); Utils.toast("Link copied.", "success"); }
        else Utils.toast("No link added yet.", "warning");
      }
    });

    form?.addEventListener("submit", e => {
      e.preventDefault();
      handleSave(new FormData(e.target), e.target.dataset.editingId);
    });
  }

  function isDuplicate(payload, excludeId) {
    return Storage.getAll("assessments").some(r =>
      r.id !== excludeId &&
      r.candidateName.trim().toLowerCase() === payload.candidateName.trim().toLowerCase() &&
      r.client.trim().toLowerCase() === payload.client.trim().toLowerCase() &&
      r.date === payload.date &&
      r.type === payload.type
    );
  }

  function handleSave(fd, editingId) {
    if (state.uploading > 0) { Utils.toast("Please wait for the file upload to finish.", "warning"); return; }
    const payload = {
      date: fd.get("date"), type: fd.get("type"), candidateName: fd.get("candidateName").trim(),
      techRole: fd.get("techRole").trim(), interviewDate: fd.get("interviewDate"), client: fd.get("client").trim(),
      status: fd.get("status")
    };
    if (!payload.candidateName || !payload.client || !payload.date) {
      Utils.toast("Please fill in candidate name, client and date.", "warning");
      return;
    }
    const existing = editingId ? Storage.find("assessments", editingId) : null;

    // Mandatory uploads once the assessment is no longer "Assessment Pending"
    if (isCompletedStatus(payload.status)) {
      const missing = (REQUIRED_ON_COMPLETE[payload.type] || []).filter(k => !isSatisfied(k, existing));
      if (missing.length) {
        document.querySelectorAll("#assessmentFileFields [data-field]").forEach(el =>
          el.classList.toggle("has-error", missing.includes(el.dataset.field)));
        Utils.toast(`Upload required before this can be marked "${payload.status}": ${missing.map(k => FIELD_LABELS[k]).join(", ")}.`, "warning", 6000);
        document.querySelector("#assessmentFileFields .has-error")?.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
    }

    payload.uploads = {};
    fieldsForType(payload.type).forEach(key => {
      if (isMulti(key)) { // list of files/links; blank rows and unfinished uploads are skipped
        payload[key] = (state.files[key] || []).filter(it => it.url && !it.uploading)
          .map(it => it.upload ? { url: it.url, upload: it.upload } : { url: it.url });
        return;
      }
      payload[key] = fd.get(key) || "";
      const up = state.files[key]?.upload;
      if (up && up.url === payload[key]) payload.uploads[key] = up;
    });

    if (!editingId && !state.pendingDuplicateOverride && isDuplicate(payload, null)) {
      showDuplicateWarning(payload);
      return;
    }
    state.pendingDuplicateOverride = false;

    const who = Auth.currentUser()?.name || "A teammate";
    let saved;
    if (editingId) {
      saved = Storage.update("assessments", editingId, payload);
      Storage.logActivity(`${who} updated an assessment for ${payload.candidateName}`, "✏️");
      Utils.toast("Assessment updated.", "success");
    } else {
      payload.id = Utils.generateId("AS");
      saved = Storage.insert("assessments", payload);
      Storage.logActivity(`${who} added an assessment for ${payload.candidateName}`, "📝");
      Utils.toast("Assessment saved.", "success");
    }

    // (the Google Sheet is updated automatically by sync.js)

    const onSaved = state.onSaved;
    closeModal();
    renderTable();
    populateFilterOptions();
    Dashboard.renderAll();
    Interviews.renderAllSchedules();
    Interviews.renderTable();
    if (onSaved) onSaved(saved);
  }

  function showDuplicateWarning(payload) {
    const overlay = document.getElementById("duplicateOverlay");
    overlay.querySelector(".duplicate__message").textContent =
      `Similar assessment already exists for ${payload.candidateName} at ${payload.client} on ${Utils.formatDate(payload.date)}.`;
    overlay.classList.add("is-open");
    const viewBtn = overlay.querySelector(".duplicate__view");
    const continueBtn = overlay.querySelector(".duplicate__continue");
    const cancelBtn = overlay.querySelector(".duplicate__cancel");
    const cleanup = () => {
      overlay.classList.remove("is-open");
      viewBtn.onclick = continueBtn.onclick = cancelBtn.onclick = null;
    };
    viewBtn.onclick = () => { cleanup(); closeModal(); Nav.goTo("assessments"); };
    continueBtn.onclick = () => {
      cleanup();
      state.pendingDuplicateOverride = true;
      document.getElementById("assessmentForm").requestSubmit();
    };
    cancelBtn.onclick = cleanup;
  }

  function init() {
    populateFilterOptions();
    bindTableEvents();
    bindModalEvents();
    renderTable();
  }

  return { init, renderTable, populateFilterOptions, openModal, openViewModal, getToolDrive, STATUS_OPTIONS, TYPE_OPTIONS };
})();
