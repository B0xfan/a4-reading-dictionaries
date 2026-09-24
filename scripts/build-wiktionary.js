'use strict';
// Builds <lang>.tsv.gz for A4 Reading's Look up from a Wiktionary extract
// made by Wiktextract (https://kaikki.org), and adds it to manifest.json.
// Run it on a normal computer (it needs to reach kaikki.org):
//
//   node scripts/build-wiktionary.js es <file or URL of the Spanish Wiktionary extract>
//   node scripts/build-wiktionary.js fr <... French Wiktionary extract>
//   node scripts/build-wiktionary.js de <... German Wiktionary extract>
//
// Use each language's OWN Wiktionary edition (John's choice: a Spanish word
// is explained in Spanish). kaikki.org lists the edition downloads; a
// ".jsonl" or ".jsonl.gz" file works, as a local path or a URL. An edition
// that holds several languages is fine: only entries whose lang_code matches
// <lang> are kept.
//
// Output, one word per line, sorted by word (same as en.tsv.gz):
//   word<TAB>[["part of speech", "meaning", "example"?], ...]
// and inflected forms point at their base word: ["=", "base", "part of speech"].
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const https = require('https');
const crypto = require('crypto');
const readline = require('readline');

const [lang, source] = process.argv.slice(2);
const NAMES = { es: 'Spanish', fr: 'French', de: 'German' };
if (!NAMES[lang] || !source) {
  console.error('usage: node scripts/build-wiktionary.js <es|fr|de> <file or URL of the Wiktextract .jsonl(.gz)>');
  process.exit(1);
}
// Part-of-speech labels in the dictionary's own language.
const POS = {
  es: { noun: 'sustantivo', verb: 'verbo', adj: 'adjetivo', adv: 'adverbio', name: 'nombre propio', pron: 'pronombre', prep: 'preposición', conj: 'conjunción', intj: 'interjección', det: 'determinante', num: 'numeral', phrase: 'locución' },
  fr: { noun: 'nom', verb: 'verbe', adj: 'adjectif', adv: 'adverbe', name: 'nom propre', pron: 'pronom', prep: 'préposition', conj: 'conjonction', intj: 'interjection', det: 'déterminant', num: 'numéral', phrase: 'locution' },
  de: { noun: 'Substantiv', verb: 'Verb', adj: 'Adjektiv', adv: 'Adverb', name: 'Eigenname', pron: 'Pronomen', prep: 'Präposition', conj: 'Konjunktion', intj: 'Interjektion', det: 'Artikel', num: 'Numerale', phrase: 'Wendung' },
}[lang];
const MAX_PER_WORD = 8;

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const get = (u, left) => https.get(u, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && left > 0) {
        res.resume();
        get(new URL(res.headers.location, u).toString(), left - 1);
        return;
      }
      if (res.statusCode !== 200) { reject(new Error(`download failed: ${res.statusCode} ${u}`)); return; }
      const out = fs.createWriteStream(dest);
      let got = 0;
      res.on('data', (c) => { got += c.length; if (got % (50 << 20) < c.length) process.stdout.write(`  ${(got / 1e6).toFixed(0)} MB\r`); });
      res.pipe(out);
      out.on('finish', () => { process.stdout.write('\n'); resolve(dest); });
      out.on('error', reject);
    }).on('error', reject);
    get(url, 5);
  });
}

async function main() {
  let file = source;
  if (/^https?:\/\//.test(source)) {
    file = path.join(os.tmpdir(), `a4r-${lang}-${path.basename(new URL(source).pathname)}`);
    if (!fs.existsSync(file)) { console.log(`Downloading ${source}`); await download(source, file); }
  }
  let input = fs.createReadStream(file);
  if (file.endsWith('.gz')) input = input.pipe(zlib.createGunzip());
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  const words = new Map();
  let lines = 0;
  let kept = 0;
  for await (const line of rl) {
    lines += 1;
    if (!line || line[0] !== '{') continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.lang_code !== lang || !e.word || !Array.isArray(e.senses)) continue;
    const word = String(e.word).trim();
    if (!word || word.length > 60 || /\s{2,}/.test(word)) continue;
    const pos = POS[e.pos] || e.pos || '';
    const list = words.get(word) || [];
    for (const s of e.senses) {
      if (list.length >= MAX_PER_WORD) break;
      const formOf = (s.form_of || s.alt_of || [])[0];
      if (formOf && formOf.word && formOf.word !== word) {
        if (!list.some((x) => x[0] === '=' && x[1] === formOf.word)) list.push(['=', formOf.word, pos]);
        continue;
      }
      const gloss = Array.isArray(s.glosses) ? s.glosses[s.glosses.length - 1] : (s.raw_glosses || [])[0];
      if (!gloss || typeof gloss !== 'string') continue;
      const def = gloss.replace(/\s+/g, ' ').trim();
      if (!def || list.some((x) => x[1] === def)) continue;
      const ex = (s.examples || []).map((x) => x && x.text).find((t) => typeof t === 'string' && t.length < 200);
      list.push(ex ? [pos, def, ex.replace(/\s+/g, ' ').trim()] : [pos, def]);
      kept += 1;
    }
    if (list.length) words.set(word, list);
  }
  // Drop pointers to words that aren't in the dictionary themselves.
  for (const [w, list] of words) {
    const good = list.filter((x) => x[0] !== '=' || words.has(x[1]));
    if (good.length) words.set(w, good); else words.delete(w);
  }

  const keys = [...words.keys()].sort();
  const tsv = `${keys.map((k) => `${k}\t${JSON.stringify(words.get(k))}`).join('\n')}\n`;
  const gz = zlib.gzipSync(Buffer.from(tsv, 'utf8'), { level: 9 });
  const root = path.join(__dirname, '..');
  fs.writeFileSync(path.join(root, `${lang}.tsv.gz`), gz);

  const manifestPath = path.join(root, 'manifest.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { format: 1, dictionaries: [] };
  manifest.dictionaries = manifest.dictionaries.filter((d) => d.lang !== lang);
  manifest.dictionaries.push({
    lang, name: NAMES[lang], file: `${lang}.tsv.gz`, bytes: gz.length, unpacked: Buffer.byteLength(tsv), words: keys.length,
    sha256: crypto.createHash('sha256').update(gz).digest('hex'),
    version: new Date().toISOString().slice(0, 10), source: `${NAMES[lang]} Wiktionary (CC BY-SA 4.0)`,
  });
  manifest.dictionaries.sort((a, b) => a.lang.localeCompare(b.lang));
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${NAMES[lang]}: read ${lines} lines, ${keys.length} words (${kept} meanings), ${(gz.length / 1e6).toFixed(1)} MB compressed -> ${lang}.tsv.gz, manifest.json updated`);
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
