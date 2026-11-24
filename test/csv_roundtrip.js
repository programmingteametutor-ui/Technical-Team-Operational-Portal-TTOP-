// Round-trip check for the CSV importer: every tab's displayed text (what Google's CSV export gives) -> importer -> compare to real values.
process.env.TZ = "Asia/Kolkata";
const fs = require("fs"), path = require("path");
const C = require("../server/app/csvimport");
const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) { console.log("usage: node test/csv_roundtrip.js <folder with workbook JSON exports>"); process.exit(0); }
let total = 0, bad = 0; const byTab = [], samples = [];
const enc = (c) => (c && typeof c === "object" && c.$d) ? new Date(c.$d) : c;
for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".json") && !f.startsWith("_"))) {
  const wb = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  for (const s of wb.sheets) {
    const n = Math.max(0, ...Object.keys(s.rows).map(Number));
    const csv = [];
    for (let i = 1; i <= n; i++) { const r = s.rows[i]; csv.push(r ? (r.d || r.v.map(x => x == null ? "" : String(x))).map(x => x == null ? "" : String(x)) : []); }
    const text = csv.map(r => r.map(x => /[",\n\r]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x).join(",")).join("\r\n");
    const got = C.convertRows(wb.id, s.name, C.parseCsv(text)).rows;
    let tb = 0;
    for (let i = 1; i <= n; i++) {
      const r = s.rows[i]; if (!r) continue;
      r.v.forEach((exp0, ci) => {
        const exp = enc(exp0); if (exp === "" || exp == null) return;
        total++;
        const g = got[i - 1] && got[i - 1].v[ci];
        let ok;
        if (exp instanceof Date) ok = g instanceof Date && Math.abs(g - exp) < 1000;
        else if (typeof exp === "number") ok = typeof g === "number" && Math.abs(g - exp) < 1e-6 * Math.max(1, Math.abs(exp));
        else ok = g === exp;
        if (!ok) { bad++; tb++; if (samples.length < 60) samples.push([wb.title + " / " + s.name, i, ci, JSON.stringify(exp0), r.d && r.d[ci], r.f && r.f[ci], g instanceof Date ? g.toISOString() : JSON.stringify(g)]); }
      });
    }
    if (tb) byTab.push([wb.title + " / " + s.name, tb]);
  }
}
console.log("cells", total, "mismatched", bad);
byTab.sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(x => console.log("  ", x[1], x[0]));
samples.forEach(s => console.log(JSON.stringify(s)));
process.exitCode = bad ? 1 : 0;
