// Extracts interview details (candidate, date, time, duration, round, type) from recruiter emails.
// No dependencies. Every value comes from the email text or existing columns; anything not found is null.

// ---------- Option lists (change these to match your app's dropdowns) ----------
const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120]; // minutes
const TYPE_RULES = [
  // [type, regex]. Checked against the subject first, then the body (earliest match wins).
  ["Hiring Manager", /\bhiring[\s-]+manager\b/i],
  ["Panel", /\bpanel\s+(interview|discussion|round)\b/i],
  ["Technical", /\btechnical\s+(interview|round|discussion|assessment|screen|call)\b|\b(coding|live[\s-]coding|system[\s-]design|tech)\s+(interview|round|screen|session)\b/i],
  ["HR", /\bHR\s+(round|interview|discussion|call|screen)\b|\bhuman\s+resources\s+(interview|round)\b/i],
  ["Recruiter", /\brecruiter\s+(call|screen|screening|interview|chat|conversation)\b|\bphone\s+screen(ing)?\b|\bscreening\s+(call|interview)\b|\binitial\s+(call|chat|conversation|screen|screening|phone)\b|\bintro(ductory)?\s+(call|chat)\b|\btalent\s+acquisition\s+(call|team)\b/i],
  ["Behavioral", /\bbehaviou?ral\s+(interview|round)\b/i],
  ["Client", /\bclient\s+(interview|round|call)\b/i],
];

// ---------- Text helpers ----------
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
const decode = (s) => String(s || "").replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => {
  if (ENT[e.toLowerCase()] !== undefined) return ENT[e.toLowerCase()];
  if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return m;
});

// Keep only the newest part of an email: drop quoted replies and forwarded headers.
function cleanBody(body) {
  let text = decode(body).replace(/\r/g, "").replace(/[​-‍⁠﻿]/g, "");
  const cut = text.search(/^\s*(On\s.{4,200}\swrote:|-{2,}\s*(Original|Forwarded)\s+Message|From:\s.+|Sent:\s.+|_{8,})\s*$/im);
  if (cut > 0) text = text.slice(0, cut);
  return text.split("\n").filter((l) => !/^\s*>/.test(l)).join("\n").replace(/[ \t]+/g, " ").slice(0, 6000);
}

// ---------- Dates ----------
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MON = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const WDAY = "(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\\.?";
const WDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const monthNum = (s) => MONTHS[s.toLowerCase().slice(0, 3)];

const ymd = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const validDay = (y, m, d) => { const x = utc(y, m, d); return x.getUTCMonth() === m - 1 && x.getUTCDate() === d; };

// Pick the year closest to the email date when the email omits it (e.g. "Oct 28" in a Dec email -> next year only if it would otherwise be >60 days in the past).
function inferYear(m, d, ref) {
  const y = ref.getUTCFullYear();
  for (const cand of [y, y + 1]) {
    if (!validDay(cand, m, d)) continue;
    if ((utc(cand, m, d) - ref) / 864e5 >= -60) return cand;
  }
  return validDay(y, m, d) ? y : null;
}

function findDates(text, ref) {
  const found = [];
  const add = (index, length, y, m, d, kind) => {
    if (!m || !d || d < 1 || d > 31) return;
    if (!y) y = inferYear(m, d, ref);
    if (!y || !validDay(y, m, d)) return;
    found.push({ index, end: index + length, date: ymd(utc(y, m, d)), kind });
  };
  let r;
  // "Tue Oct 28, 2026" / "October 28th" / "Oct 28"
  const p1 = new RegExp(`\\b(?:${WDAY},?\\s+)?${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*(?:minutes?|mins?|hours?|hrs?|:\\d))(?:,?\\s+(\\d{4}))?`, "gi");
  while ((r = p1.exec(text))) add(r.index, r[0].length, r[3] && +r[3], monthNum(r[1]), +r[2], "text");
  // "Tuesday, 28 October 2026" / "28th Oct"
  const p2 = new RegExp(`\\b(?:${WDAY},?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MON}\\b(?:,?\\s+(\\d{4}))?`, "gi");
  while ((r = p2.exec(text))) add(r.index, r[0].length, r[3] && +r[3], monthNum(r[2]), +r[1], "text");
  // ISO 2026-10-28
  const p3 = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;
  while ((r = p3.exec(text))) add(r.index, r[0].length, +r[1], +r[2], +r[3], "iso");
  // 28/10/2026 or 10/28/2026 — only when unambiguous (one part > 12)
  const p4 = /\b(\d{1,2})[/.](\d{1,2})[/.](20\d{2})\b/g;
  while ((r = p4.exec(text))) {
    const a = +r[1], b = +r[2];
    if (a > 12 && b <= 12) add(r.index, r[0].length, +r[3], b, a, "numeric");
    else if (b > 12 && a <= 12) add(r.index, r[0].length, +r[3], a, b, "numeric");
  }
  // today / tomorrow
  const p5 = /\b(today|tomorrow)\b/gi;
  while ((r = p5.exec(text))) {
    const d = new Date(ref.getTime() + (r[1].toLowerCase() === "tomorrow" ? 864e5 : 0));
    found.push({ index: r.index, end: r.index + r[0].length, date: ymd(d), kind: "relative" });
  }
  // "on Thursday" / "this Friday" / "next Monday"
  const p6 = new RegExp(`\\b(on|this|next|coming)\\s+(${WDAY})`, "gi");
  while ((r = p6.exec(text))) {
    const target = WDAYS[r[2].toLowerCase().slice(0, 3)];
    let diff = (target - ref.getUTCDay() + 7) % 7 || 7;
    found.push({ index: r.index, end: r.index + r[0].length, date: ymd(new Date(ref.getTime() + diff * 864e5)), kind: "weekday" });
  }
  // remove overlaps: explicit dates beat "on Tuesday"/"tomorrow", then longer beats shorter
  const RANK = { text: 0, iso: 0, numeric: 0, relative: 1, weekday: 2 };
  found.sort((a, b) => RANK[a.kind] - RANK[b.kind] || (b.end - b.index) - (a.end - a.index));
  const out = [];
  for (const f of found) if (!out.some((o) => f.index < o.end && o.index < f.end)) out.push(f);
  return out.sort((a, b) => a.index - b.index);
}

// ---------- Times ----------
const TZ_RE = /^\s*\(?\s*(India Standard Time|British Summer Time|Greenwich Mean Time|(?:Eastern|Central|Mountain|Pacific) (?:Standard |Daylight )?Time|IST|BST|GMT(?:\s*[+-]\s*\d{1,2}(?::?\d{2})?)?|UTC(?:\s*[+-]\s*\d{1,2}(?::?\d{2})?)?|[ECMP][SD]T|ET|CT|PT|MT|CET|CEST|EET|EEST|AEST|AEDT|SGT|JST|GST)\b/;
const to24 = (h, mer) => {
  mer = mer ? mer.replace(/\./g, "").toLowerCase() : "";
  if (mer === "pm" && h < 12) return h + 12;
  if (mer === "am" && h === 12) return 0;
  return h;
};
function findTimes(text) {
  const found = [];
  let r;
  // ranges: "10am - 11am", "10 - 11am", "10:00 – 11:00", "2:30pm to 3:15pm"
  const range = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:-|–|—|to|until)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?![\d/])/gi;
  while ((r = range.exec(text))) {
    const hasColon = r[2] !== undefined || r[5] !== undefined;
    if (!r[3] && !r[6] && !hasColon) continue; // "10-11" alone is too ambiguous
    let h1 = +r[1], h2 = +r[4];
    const m1 = +(r[2] || 0), m2 = +(r[5] || 0);
    if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) continue;
    const mer2 = r[6] || r[3], mer1 = r[3] || (r[6] && h1 <= h2 ? r[6] : null);
    h1 = to24(h1, mer1); h2 = to24(h2, mer2);
    if (!r[3] && !r[6]) { if (h1 < 7) h1 += 12; if (h2 < 7) h2 += 12; }
    let dur = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (dur <= 0 || dur > 240) dur = null;
    found.push({ index: r.index, end: r.index + r[0].length, h: h1, m: m1, duration: dur });
  }
  // single: "10am", "10:30 AM", "2.30pm", "14:00", "noon"
  const single = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])|\b([01]?\d|2[0-3]):([0-5]\d)\b|\b(noon|midday)\b/gi;
  while ((r = single.exec(text))) {
    let h, m;
    if (r[6]) { h = 12; m = 0; }
    else if (r[3]) { h = +r[1]; m = +(r[2] || 0); if (h < 1 || h > 12 || m > 59) continue; h = to24(h, r[3]); }
    else { h = +r[4]; m = +r[5]; if (h < 7) h += 12; } // 24h text with no am/pm: "1:30" in an interview email means 13:30
    found.push({ index: r.index, end: r.index + r[0].length, h, m, duration: null });
  }
  found.sort((a, b) => a.index - b.index || (b.end - b.index) - (a.end - a.index));
  const out = [];
  for (const f of found) { const last = out[out.length - 1]; if (!last || f.index >= last.end) out.push(f); }
  for (const t of out) {
    const tz = TZ_RE.exec(text.slice(t.end, t.end + 40));
    t.tz = tz ? tz[1].replace(/\s+/g, " ") : null;
    t.time = `${String(t.h).padStart(2, "0")}:${String(t.m).padStart(2, "0")}`;
  }
  return out;
}

// ---------- Choosing the interview date/time ----------
const POSITIVE = /interview|call\b|meeting|schedul|confirm|invit|join|book|slot|session|chat|conversation|speak|appointment|calendar|teams|zoom|google meet|webex|reminder/i;
const NEGATIVE = /deadline|expire|expiry|due\b|closing|closes|applied|application (was )?(received|submitted)|submitted|posted|start date|joining date|valid until|complete (it )?by|before\b|no later than|sent:/i;
const OPTIONS_HINT = /\b(options?|availability|available slots?|which (date|time|slot|of these)|choose|select a (time|slot)|prefer|pick (a|one|your)|following (times|slots|dates)|propose|works best|let me know (a|your|which)|time slots?)\b/i;
const CONFIRMED_HINT = /\b(confirmed|(?:is|are|has been|have been|have|we've|was) scheduled|booked|booking confirmed|calendar invite|invitation(?=:)|updated invitation|reminder|see you|look forward to (speaking|meeting|seeing)|is tomorrow|is today|accepted)\b/i;

function pickWhen(subject, body, receivedStr) {
  const ref = new Date(String(receivedStr).slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(ref.getTime())) return null;
  const refDay = ymd(ref);
  const maxDay = ymd(new Date(ref.getTime() + 120 * 864e5));
  const parts = [["subject", decode(subject)], ["body", body]];
  const cands = [];
  for (const [src, text] of parts) {
    if (!text) continue;
    const times = findTimes(text);
    for (const d of findDates(text, ref)) {
      if (d.date < refDay || d.date > maxDay) continue; // interview must be on/after the email date
      const before = text.slice(Math.max(0, d.index - 60), d.index);
      const around = text.slice(Math.max(0, d.index - 120), d.end + 120);
      if (NEGATIVE.test(before)) continue;
      // nearest time just after the date (up to 60 chars) or just before it (up to 40 chars)
      let time = null, best = Infinity;
      for (const t of times) {
        const gapAfter = t.index - d.end, gapBefore = d.index - t.end;
        const gap = gapAfter >= 0 && gapAfter <= 60 ? gapAfter : gapBefore >= 0 && gapBefore <= 40 ? gapBefore + 5 : Infinity;
        if (gap < best) { best = gap; time = t; }
      }
      let score = 0;
      if (time) score += 3;
      if (src === "subject") score += 2;
      if (POSITIVE.test(around)) score += 2;
      if (d.kind === "weekday") score -= 1;
      score -= d.index / 10000;
      cands.push({ src, ...d, time, score, evidence: text.slice(Math.max(0, d.index - 40), (time ? Math.max(time.end, d.end) : d.end) + 30).replace(/\s+/g, " ").trim() });
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score);
  const top = cands[0];
  const allText = `${subject}\n${body}`;
  const distinct = [];
  for (const c of cands) {
    if (c.score < top.score - 2.5) continue;
    const key = c.date + (c.time ? " " + c.time.time : "");
    if (!distinct.some((x) => x.key === key || (x.date === c.date && (!c.time || !x.time)))) distinct.push({ key, date: c.date, time: c.time?.time || null, tz: c.time?.tz || null });
  }
  const multipleDays = new Set(distinct.map((x) => x.date)).size > 1;
  const status = multipleDays && OPTIONS_HINT.test(allText) ? "options"
    : CONFIRMED_HINT.test(allText) ? "confirmed"
    : OPTIONS_HINT.test(allText) ? "proposed"
    : "mentioned";
  return {
    date: top.date,
    time: top.time?.time || null,
    timezone: top.time?.tz || null,
    rangeDuration: top.time?.duration || null,
    status,
    options: status === "options" ? distinct.slice(0, 6) : [],
    evidence: top.evidence,
  };
}

// ---------- Duration / round / type / candidate name ----------
const WORDNUM = { a: 1, an: 1, one: 1, two: 2, three: 3, half: 0.5 };
function pickDuration(text) {
  const re = /\b(half an hour|half-hour|(\d{1,3}(?:\.\d)?|an?|one|two)[\s-]*(hours?|hrs?|minutes?|mins?)\b)(?:\s*(?:long|duration))?/gi;
  let r;
  while ((r = re.exec(text))) {
    const around = text.slice(Math.max(0, r.index - 60), r.index + r[0].length + 60);
    if (!/interview|call|meeting|session|chat|conversation|discussion|video|phone|teams|zoom|slot|duration|round/i.test(around)) continue;
    if (/(?:within|in|after|before|ago|every|up to)\s*$/i.test(text.slice(Math.max(0, r.index - 12), r.index))) continue;
    if (/^\s*(before|after|early|prior|late|ago|from now)\b/i.test(text.slice(r.index + r[0].length, r.index + r[0].length + 15))) continue;
    let mins;
    if (/half/i.test(r[1])) mins = 30;
    else {
      const n = WORDNUM[(r[2] || "").toLowerCase()] ?? Number(r[2]);
      mins = /^h/i.test(r[3]) ? n * 60 : n;
    }
    if (mins >= 10 && mins <= 240) return { minutes: mins, evidence: r[0].trim() };
  }
  return null;
}
const snapDuration = (m) => (m ? DURATION_OPTIONS.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a)) : null);

const ORD = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, fifth: 5, "5th": 5 };
function pickRound(text) {
  const tests = [
    [/\bfinal[\s-]+(round|interview|stage)\b/i, () => "Final Round"],
    [/\bround\s*(?:#|no\.?\s*)?([1-9])\b/i, (r) => `Round ${r[1]}`],
    [/\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)[\s-]+(round|interview|stage)\b/i, (r) => `Round ${ORD[r[1].toLowerCase()]}`],
    [/\bround\s+(one|two|three|four|five)\b/i, (r) => `Round ${{ one: 1, two: 2, three: 3, four: 4, five: 5 }[r[1].toLowerCase()]}`],
  ];
  let best = null;
  for (const [re, fn] of tests) {
    const r = re.exec(text);
    if (r && (!best || r.index < best.index)) best = { index: r.index, value: fn(r), evidence: r[0] };
  }
  return best;
}
function pickType(text) {
  let best = null;
  for (const [type, re] of TYPE_RULES) {
    const r = re.exec(text);
    if (r && (!best || r.index < best.index)) best = { index: r.index, value: type, evidence: r[0] };
  }
  return best;
}

const titleCase = (s) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s);
function pickCandidateName(toHeader, body, emails) {
  const wanted = emails.filter(Boolean).map((e) => e.toLowerCase());
  for (const part of String(toHeader || "").split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
    const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(part);
    if (m && m[1].trim() && !m[1].includes("@") && wanted.includes(m[2].trim().toLowerCase()))
    {
      let n = titleCase(decode(m[1].trim()));
      const lf = /^([^,]+),\s*([^,]+)$/.exec(n); // "Kumar, Ravi" -> "Ravi Kumar"
      if (lf) n = `${lf[2]} ${lf[1]}`;
      return { value: n, source: "to_header" };
    }
  }
  const labelled = /\b(?:Candidate(?: name)?|Name)\s*:\s*([A-Z][A-Za-z'.-]+(?:[ \t]+[A-Z][A-Za-z'.-]+){0,3})/.exec(body);
  if (labelled) return { value: labelled[1].trim(), source: "body" };
  const greet = /^\s*(?:hi|hello|dear|hey)[ \t]+([A-Z][A-Za-z'-]+(?:[ \t]+[A-Z][A-Za-z'-]+){0,2})\s*[,!:\n]/im.exec(body.slice(0, 400));
  if (greet && !/^(there|team|candidate|all|sir|madam|applicant|hiring)$/i.test(greet[1])) return { value: titleCase(greet[1].trim()), source: "greeting" };
  return null;
}

// ---------- Per message, then merged per thread ----------
function extractMessage(msg) {
  const body = cleanBody(msg.body);
  const subject = decode(msg.subject || "");
  const text = `${subject}\n${body}`;
  const when = pickWhen(subject, body, msg.internal_date);
  const dur = pickDuration(text);
  const minutes = dur?.minutes || when?.rangeDuration || null;
  const round = pickRound(subject) || pickRound(body);
  const typeSubj = pickType(subject);
  const type = typeSubj || pickType(body);
  const name = pickCandidateName(msg.to_header, body, [msg.mailbox, msg.student_email]);
  return {
    message_id: msg.id,
    candidate_name: name?.value || null, candidate_name_source: name?.source || null,
    role: msg.role || null, client: msg.company || null,
    date: when?.date || null, time: when?.time || null, timezone: when?.timezone || null,
    schedule_status: when?.status || null, date_options: when?.options || [],
    duration_minutes: minutes, duration_option: snapDuration(minutes),
    round: round?.value || null, type: type?.value || null,
    evidence: {
      date: when?.evidence || null,
      duration: dur?.evidence || (when?.rangeDuration ? "time range" : null),
      round: round?.evidence || null, type: type?.evidence || null,
    },
  };
}

// msgs: newest first. Newest non-empty value wins per field, so reschedules override older dates.
function mergeThread(msgs, latestReceived) {
  const ex = msgs.map(extractMessage);
  const first = (k) => ex.find((e) => e[k] !== null && e[k] !== undefined && !(Array.isArray(e[k]) && !e[k].length));
  const out = { sheet_update_date: latestReceived ? String(latestReceived).slice(0, 10) : null, sources: {}, evidence: {} };
  for (const k of ["candidate_name", "role", "client", "duration_minutes", "round", "type"]) {
    const e = first(k);
    out[k] = e ? e[k] : null;
    if (e) out.sources[k] = e.message_id;
  }
  const name = first("candidate_name");
  out.candidate_name_source = name?.candidate_name_source || null;
  out.duration_option = snapDuration(out.duration_minutes);
  const when = first("date");
  Object.assign(out, {
    date: when?.date || null, time: when?.time || null, timezone: when?.timezone || null,
    schedule_status: when?.schedule_status || null, date_options: when?.date_options || [],
  });
  if (when) out.sources.date = when.message_id;
  for (const k of ["date", "duration", "round", "type"]) {
    const e = ex.find((x) => x.evidence[k]);
    out.evidence[k] = e ? e.evidence[k] : null;
  }
  return out;
}

module.exports = { extractMessage, mergeThread, cleanBody, findDates, findTimes, pickWhen, DURATION_OPTIONS, TYPE_RULES };
