"use strict";
/**
 * SpreadsheetApp.getUi() emulation for menu functions run from the sheet
 * editor. Alerts are collected and shown to the user afterwards. Questions
 * (YES/NO alerts, prompts) cannot block a server thread, so the first time a
 * question is reached the execution is rolled back and the question is sent to
 * the browser; once answered, the function is re-run with the recorded answers.
 */
const { UiInputNeeded } = require("./runtime");

const BUTTON_SETS = { OK: "OK", OK_CANCEL: "OK_CANCEL", YES_NO: "YES_NO", YES_NO_CANCEL: "YES_NO_CANCEL" };
const BUTTONS = { OK: "OK", CANCEL: "CANCEL", YES: "YES", NO: "NO", CLOSE: "CLOSE" };

function makeUiSink(answers) {
  answers = answers || [];
  let asked = 0;
  const sink = { alerts: [], toasts: [], menus: [], dialogs: [], pending: null };
  const need = (req) => {
    if (!sink.pending) sink.pending = Object.assign(req, { index: asked - 1 });
    throw new UiInputNeeded(sink.pending);
  };
  const splitArgs = (a, b, c) => {
    let title = "", msg, buttons;
    if (c !== undefined) { title = a; msg = b; buttons = c; }
    else if (b !== undefined && BUTTON_SETS[b]) { msg = a; buttons = b; }
    else if (b !== undefined) { title = a; msg = b; }
    else msg = a;
    return { title: String(title || ""), msg: String(msg === undefined ? "" : msg), buttons: buttons || "OK" };
  };
  const menuBuilder = (name) => {
    const m = { name: String(name), items: [] };
    const M = {
      __m: m,
      addItem: (caption, fn) => { m.items.push({ caption: String(caption), fn: String(fn) }); return M; },
      addSeparator: () => { m.items.push({ separator: true }); return M; },
      addSubMenu: (sub) => { m.items.push({ submenu: sub.__m }); return M; },
      addToUi: () => { sink.menus.push(m); }
    };
    return M;
  };
  sink.ui = {
    alert: (a, b, c) => {
      if (sink.pending) need({});
      const { title, msg, buttons } = splitArgs(a, b, c);
      if (buttons === "OK") { sink.alerts.push({ title, msg }); return BUTTONS.OK; }
      const ans = answers[asked++];
      if (!ans) need({ type: "alert", title, msg, buttons });
      return ans.button;
    },
    prompt: (a, b, c) => {
      if (sink.pending) need({});
      const { title, msg, buttons } = splitArgs(a, b, c);
      const ans = answers[asked++];
      if (!ans) need({ type: "prompt", title, msg, buttons: buttons || "OK" });
      return { getResponseText: () => String(ans.text || ""), getSelectedButton: () => ans.button };
    },
    createMenu: menuBuilder,
    createAddonMenu: () => menuBuilder("Add-ons"),
    showModalDialog: (html, title) => { sink.dialogs.push({ title: String(title || ""), html: html && html.getContent ? html.getContent() : String(html) }); },
    showModelessDialog: (html, title) => { sink.dialogs.push({ title: String(title || ""), html: html && html.getContent ? html.getContent() : String(html) }); },
    showSidebar: (html) => { sink.dialogs.push({ title: html && html.getTitle ? html.getTitle() : "", html: html && html.getContent ? html.getContent() : String(html) }); },
    Button: BUTTONS,
    ButtonSet: BUTTON_SETS
  };
  sink.toast = (msg) => sink.toasts.push(msg);
  return sink;
}

module.exports = { makeUiSink };
