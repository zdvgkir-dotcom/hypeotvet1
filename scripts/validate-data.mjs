#!/usr/bin/env node
import fs from "node:fs";
import vm from "node:vm";

// Clean accidental <b>/<code> HTML tags inside double-quoted short strings in packs >= 19
if (process.argv.includes("--clean-short")) {
  for (const f of fs.readdirSync("data").filter((x) => /^pack-(19|[2-9]\d|\d{3})\.js$/.test(x)).sort()) {
    const p = "data/" + f;
    let txt = fs.readFileSync(p, "utf8");
    // Only strip <b>, <i>, <code> on lines starting with 6 spaces + double quote (short / title)
    const lines = txt.split(/\r?\n/).map((line) => {
      if (/^      ".*",\s*$/.test(line) && /<\/?(b|i|code)>/i.test(line)) {
        return line.replace(/<\/?(b|i|code)>/gi, "");
      }
      return line;
    });
    fs.writeFileSync(p, lines.join("\n"), "utf8");
  }
}

const s = { window: {} };
vm.createContext(s);
vm.runInContext(fs.readFileSync("data.js", "utf8"), s, { filename: "data.js" });
const files = fs.readdirSync("data").filter((x) => x.endsWith(".js")).sort();
for (const f of files) {
  vm.runInContext(fs.readFileSync("data/" + f, "utf8"), s, { filename: "data/" + f });
}

const { categories, questions } = s.window.SITE_DATA;
const catSet = new Set(categories.map((c) => c.id));
const ids = new Set();
const titles = new Set();
const dupId = [], dupT = [], badCat = [], badId = [], emoji = [], htmlShort = [];

for (const q of questions) {
  if (ids.has(q.id)) dupId.push(q.id);
  ids.add(q.id);
  const tn = q.title.toLowerCase().trim();
  if (titles.has(tn)) dupT.push(q.title);
  titles.add(tn);
  if (!catSet.has(q.cat)) badCat.push(`${q.id}:${q.cat}`);
  if (!/^[a-z0-9-]+$/.test(q.id)) badId.push(q.id);
  if (/\p{Extended_Pictographic}/u.test(q.title + q.short + q.answer)) emoji.push(q.id);
  if (/<[a-z/]/i.test(q.short)) htmlShort.push(q.id);
}

console.log(`TOTAL: ${questions.length} questions across ${files.length} packs + data.js`);
console.log(`dupId: ${dupId.length}`, dupId);
console.log(`dupTitle: ${dupT.length}`, dupT);
console.log(`badCat: ${badCat.length}`, badCat);
console.log(`badId: ${badId.length}`, badId);
console.log(`emoji: ${emoji.length}`, emoji.slice(0, 5));
console.log(`htmlShort: ${htmlShort.length}`, htmlShort.slice(0, 10));

if (dupId.length || dupT.length || badCat.length || badId.length || emoji.length || htmlShort.length) {
  process.exit(1);
}
console.log("VALIDATION PASSED 100%");
