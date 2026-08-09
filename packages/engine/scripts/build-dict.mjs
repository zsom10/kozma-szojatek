import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const dictDir = dirname(require.resolve("dictionary-hu"));
const dicText = readFileSync(join(dictDir, "index.dic"), "utf8");

const ALLOWED = /^[a-záéíóöőúüűA-ZÁÉÍÓÖŐÚÜŰ]+$/;
const VOWELS = /[aáeéiíoóöőuúüű]/i;

function cleanToken(raw) {
  let w = raw.trim();
  if (!w) return null;
  const slash = w.indexOf("/");
  if (slash !== -1) w = w.slice(0, slash);
  const tab = w.indexOf("\t");
  if (tab !== -1) w = w.slice(0, tab);
  w = w.replace(/^\ufeff/, "");
  if (w.includes("-")) return null;
  if (w.length < 2) return null;
  if (!ALLOWED.test(w)) return null;
  if (w !== w.toLocaleLowerCase("hu")) return null;
  const lower = w.toLocaleLowerCase("hu");
  if (!VOWELS.test(lower)) return null;
  return lower;
}

function extractExtraForms(line) {
  const forms = [];
  const parts = line.split("\t");
  for (let i = 1; i < parts.length; i++) {
    for (const piece of parts[i].split(/[\s,;]+/)) {
      const c = cleanToken(piece);
      if (c) forms.push(c);
    }
  }
  return forms;
}

function toKey(word) {
  return word.toLocaleUpperCase("hu").normalize("NFC");
}

const stems = new Set();
const forms = new Set();
const lines = dicText.split(/\r?\n/);

for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line) continue;
  const stem = cleanToken(line);
  if (!stem) continue;
  stems.add(toKey(stem));
  for (const f of extractExtraForms(line)) {
    forms.add(toKey(f));
  }
}

const all = new Set([...stems, ...forms]);
const sortedStems = [...stems].sort((a, b) => a.localeCompare(b, "hu"));
const sortedAll = [...all].sort((a, b) => a.localeCompare(b, "hu"));

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "../data");
mkdirSync(outDir, { recursive: true });

writeFileSync(join(outDir, "stems.txt"), sortedStems.join("\n") + "\n");
writeFileSync(
  join(outDir, "stems.txt.gz"),
  gzipSync(Buffer.from(sortedStems.join("\n") + "\n", "utf8"))
);
writeFileSync(join(outDir, "forms.txt"), sortedAll.join("\n") + "\n");
writeFileSync(
  join(outDir, "forms.txt.gz"),
  gzipSync(Buffer.from(sortedAll.join("\n") + "\n", "utf8"))
);

try {
  const { unlinkSync } = await import("node:fs");
  unlinkSync(join(outDir, "words.txt"));
  unlinkSync(join(outDir, "words.txt.gz"));
} catch {}

console.log(
  JSON.stringify(
    { stems: stems.size, forms: all.size, outDir },
    null,
    2
  )
);
