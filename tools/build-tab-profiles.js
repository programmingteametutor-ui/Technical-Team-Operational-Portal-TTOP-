// Builds config/tab-profiles.json: for every Dhruva tab, what kind of value each column holds
// (text / number / date / TRUE-FALSE) and in which display format. The CSV importer uses it to
// turn Google's CSV text ("24-Aug-2026", "₹3,900") back into real dates and numbers.
// Input: workbook JSON files in the server's row format (one per spreadsheet). No cell values are kept.
// usage: node tools/build-tab-profiles.js <dir-with-workbook-json> > config/tab-profiles.json
const fs = require("fs"), path = require("path");
const dir = process.argv[2];
const out = { generated: new Date().toISOString().slice(0, 10), workbooks: {} };
for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".json") && !f.startsWith("_"))) {
  const wb = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const W = out.workbooks[wb.id] = { title: wb.title, tabs: {} };
  for (const s of wb.sheets) {
    const cols = [];
    for (const r of Object.values(s.rows || {})) {
      (r.v || []).forEach((c, i) => {
        if (c === "" || c === null || c === undefined) return;
        const p = cols[i] = cols[i] || { types: {}, dateFormats: {}, numberFormats: {}, text: 0, years: {} };
        const fmt = r.f && r.f[i] || null;
        let t;
        if (c && typeof c === "object" && c.$d) {
          t = "date"; p.dateFormats[fmt || "M/d/yyyy H:mm:ss"] = (p.dateFormats[fmt || "M/d/yyyy H:mm:ss"] || 0) + 1;
          const y = new Date(c.$d).getUTCFullYear(); p.years[y] = (p.years[y] || 0) + 1;
        } else if (typeof c === "number") { t = "number"; const k = fmt || ""; p.numberFormats[k] = (p.numberFormats[k] || 0) + 1; }
        else if (typeof c === "boolean") t = "bool";
        else { t = "text"; if (fmt === "@") p.text++; }
        p.types[t] = (p.types[t] || 0) + 1;
      });
    }
    W.tabs[s.name] = { index: s.index, sheetId: s.sheetId, frozenRows: s.frozenRows || 0, maxCols: s.maxCols, cols: cols.map(c => c || null) };
  }
}
process.stdout.write(JSON.stringify(out));
