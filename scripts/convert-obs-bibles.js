#!/usr/bin/env node
/**
 * Converts OBS Bible Plugin .js files into ScriptureFlow's JSON format.
 * Usage: node scripts/convert-obs-bibles.js
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '..', 'public', 'bibles');

const SOURCES = [
  {
    src: 'C:\\Users\\Tioluwani\\Downloads\\obs-bible-plugin\\obs-bible-plugin\\assets\\bibles\\esv\\esv.js',
    abbrev: 'ESV',
    displayName: 'English Standard Version',
    filename: 'esv',
  },
  {
    src: 'C:\\Users\\Tioluwani\\Downloads\\obs-bible-plugin\\obs-bible-plugin\\assets\\bibles\\nkjv\\nkjv.js',
    abbrev: 'NKJV',
    displayName: 'New King James Version',
    filename: 'nkjv',
  },
  {
    src: 'C:\\Users\\Tioluwani\\Downloads\\obs-bible-plugin\\obs-bible-plugin\\assets\\bibles\\amplified\\amplified.js',
    abbrev: 'AMP',
    displayName: 'Amplified Bible',
    filename: 'amp',
  },
];

function parseOBSBible(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  // Strip JS variable wrapper: "var bible_data = [...];"
  const jsonStr = raw
    .replace(/^\s*var\s+\w+\s*=\s*/, '')
    .replace(/;\s*$/, '')
    .trim();
  return JSON.parse(jsonStr);
}

function convert(entries, abbrev, displayName) {
  const books = {};

  for (const entry of entries) {
    // name is like "Genesis 1:1", "1 Corinthians 13:4", "Song of Solomon 1:1"
    const match = entry.name.match(/^(.+?)\s+(\d+):(\d+)$/);
    if (!match) {
      console.warn(`  Skipping unparseable entry: ${entry.name}`);
      continue;
    }

    const [, bookName, chapterStr, verseStr] = match;

    if (!books[bookName]) books[bookName] = {};
    if (!books[bookName][chapterStr]) books[bookName][chapterStr] = {};
    books[bookName][chapterStr][verseStr] = entry.verse;
  }

  const totalVerses = Object.values(books).reduce(
    (sum, chs) => sum + Object.values(chs).reduce((s, vs) => s + Object.keys(vs).length, 0),
    0
  );

  console.log(`  ${abbrev}: ${Object.keys(books).length} books, ${totalVerses.toLocaleString()} verses`);
  return { version: abbrev, name: displayName, books };
}

mkdirSync(OUTPUT_DIR, { recursive: true });
console.log('Converting OBS Bible files to ScriptureFlow format...\n');

for (const source of SOURCES) {
  process.stdout.write(`Reading ${source.abbrev}...`);
  const entries = parseOBSBible(source.src);
  process.stdout.write(` ${entries.length.toLocaleString()} entries\n`);

  const data = convert(entries, source.abbrev, source.displayName);
  const outPath = join(OUTPUT_DIR, `${source.filename}.json`);
  writeFileSync(outPath, JSON.stringify(data), 'utf8');

  const sizeMB = (JSON.stringify(data).length / 1024 / 1024).toFixed(1);
  console.log(`  Saved: ${outPath} (${sizeMB} MB)\n`);
}

console.log('Done! Run "npm run build" then restart the preview.');
