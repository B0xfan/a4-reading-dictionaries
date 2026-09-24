'use strict';
// Builds dist/en.tsv.gz for A4 Reading's Look up from Princeton WordNet
// (the `wordnet-db` npm package, WordNet 3.1). One line per word, sorted by
// word, so the plugin can binary-search the file without loading it:
//
//   word<TAB>[["verb","meaning","example"], ...]
//
// Senses keep WordNet's own order (most common first), up to 4 per part of
// speech and 8 in all. Irregular forms from WordNet's exception lists
// ("went" -> "go") are kept as pointers: ["=", "go", "verb"].
//
// Usage: node scripts/build-wordnet.js <wordnet-db/dict> <wndb-with-exceptions/data>
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const dir = process.argv[2];
const excDir = process.argv[3];
if (!dir || !excDir) { console.error('usage: node scripts/build-wordnet.js <wordnet-db/dict> <wndb-with-exceptions/data>'); process.exit(1); }
const POS = { noun: 'noun', verb: 'verb', adj: 'adjective', adv: 'adverb' };
const MAX_PER_POS = 4;
const MAX_TOTAL = 8;

function readData(file) {
  const buf = fs.readFileSync(file);
  return (offset) => {
    const end = buf.indexOf(10, offset);
    return buf.toString('utf8', offset, end === -1 ? buf.length : end);
  };
}

function gloss(line) {
  const bar = line.indexOf(' | ');
  if (bar === -1) return null;
  const text = line.slice(bar + 3).trim();
  // "definition; \"example\"; \"another\""
  const firstQuote = text.indexOf('"');
  const def = (firstQuote === -1 ? text : text.slice(0, firstQuote)).replace(/[;\s]+$/, '').trim();
  const ex = firstQuote === -1 ? '' : (/"([^"]+)"/.exec(text.slice(firstQuote)) || [])[1] || '';
  return def ? [def, ex] : null;
}

const words = new Map();
for (const [file, label] of Object.entries(POS)) {
  const data = readData(path.join(dir, `data.${file}`));
  for (const line of fs.readFileSync(path.join(dir, `index.${file}`), 'utf8').split('\n')) {
    if (!line || line.startsWith(' ')) continue; // licence header lines start with spaces
    const f = line.trim().split(/\s+/);
    const lemma = f[0].replace(/_/g, ' ');
    const synsetCnt = Number(f[2]);
    const offsets = f.slice(f.length - synsetCnt).map(Number);
    const senses = words.get(lemma) || [];
    let added = 0;
    for (const off of offsets) {
      if (added >= MAX_PER_POS || senses.length >= MAX_TOTAL) break;
      const g = gloss(data(off));
      if (!g) continue;
      senses.push(g[1] ? [label, g[0], g[1]] : [label, g[0]]);
      added += 1;
    }
    if (senses.length) words.set(lemma, senses);
  }
}

// Irregular forms: point each one at its base word(s) for that part of speech.
for (const [file, label] of Object.entries(POS)) {
  for (const line of fs.readFileSync(path.join(excDir, `${file}.exc`), 'utf8').split('\n')) {
    const f = line.trim().split(/\s+/);
    if (f.length < 2) continue;
    const form = f[0].replace(/_/g, ' ');
    const entry = words.get(form) || [];
    for (const base of f.slice(1).map((b) => b.replace(/_/g, ' '))) {
      if (base === form || !words.has(base)) continue;
      if (!entry.some((s) => s[0] === '=' && s[1] === base && s[2] === label)) entry.push(['=', base, label]);
    }
    if (entry.length) words.set(form, entry);
  }
}

const keys = [...words.keys()].sort();
const tsv = keys.map((k) => `${k}\t${JSON.stringify(words.get(k))}`).join('\n') + '\n';
const out = path.join(__dirname, '..');
fs.mkdirSync(out, { recursive: true });
const gz = zlib.gzipSync(Buffer.from(tsv, 'utf8'), { level: 9 });
fs.writeFileSync(path.join(out, 'en.tsv.gz'), gz);
console.log(`${keys.length} words, ${(tsv.length / 1e6).toFixed(1)} MB plain, ${(gz.length / 1e6).toFixed(1)} MB compressed`);
