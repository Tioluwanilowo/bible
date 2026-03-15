#!/usr/bin/env node
/**
 * ScriptureFlow Bible Downloader
 * Downloads public domain Bible versions from getbible.net and saves them
 * to public/bibles/ in the format expected by the app.
 *
 * Usage: node scripts/download-bibles.js
 *    or: npm run setup-bibles
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '..', 'public', 'bibles');

// Canonical book names matching the app's BookAliasResolver (order = Bible order, index+1 = book number)
const BOOK_NAMES = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
  'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel',
  '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra',
  'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs',
  'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah', 'Lamentations',
  'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
  'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk',
  'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
  'Matthew', 'Mark', 'Luke', 'John', 'Acts',
  'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
  'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy',
  '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James',
  '1 Peter', '2 Peter', '1 John', '2 John', '3 John',
  'Jude', 'Revelation',
];

// Public domain versions available on getbible.net
const VERSIONS = [
  { id: 'kjv', abbrev: 'KJV', displayName: 'King James Version' },
  { id: 'basicenglish', abbrev: 'BBE', displayName: 'Bible in Basic English', filename: 'bbe' },
  { id: 'asv', abbrev: 'ASV', displayName: 'American Standard Version' },
  { id: 'web', abbrev: 'WEB', displayName: 'World English Bible' },
];

async function fetchWithRetry(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
      return await resp.json();
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = 1000 * attempt;
      process.stdout.write(`  Retry ${attempt}/${retries - 1} after ${delay}ms...\r`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function downloadBook(versionId, bookNum) {
  const data = await fetchWithRetry(
    `https://api.getbible.net/v2/${versionId}/${bookNum}.json`
  );

  const bookName = BOOK_NAMES[bookNum - 1];
  const chapters = {};

  for (const chapter of data.chapters) {
    const chNum = chapter.chapter.toString();
    chapters[chNum] = {};
    for (const verse of chapter.verses) {
      chapters[chNum][verse.verse.toString()] = verse.text.trim();
    }
  }

  return { bookName, chapters };
}

async function downloadVersion(version) {
  console.log(`\nDownloading ${version.displayName} (${version.abbrev})...`);

  const books = {};
  const BATCH = 11; // Books per parallel batch

  for (let start = 1; start <= 66; start += BATCH) {
    const end = Math.min(start + BATCH - 1, 66);
    const bookNums = Array.from({ length: end - start + 1 }, (_, i) => start + i);

    process.stdout.write(`  Books ${start}-${end}/66...\r`);

    const results = await Promise.all(
      bookNums.map(bookNum => downloadBook(version.id, bookNum))
    );

    for (const { bookName, chapters } of results) {
      books[bookName] = chapters;
    }
  }

  const totalVerses = Object.values(books).reduce(
    (sum, chs) => sum + Object.values(chs).reduce((s, vs) => s + Object.keys(vs).length, 0),
    0
  );

  console.log(`  Done: ${Object.keys(books).length} books, ${totalVerses.toLocaleString()} verses`);

  return {
    version: version.abbrev,
    name: version.displayName,
    books,
  };
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('ScriptureFlow Bible Downloader');
  console.log('==============================');
  console.log(`Output directory: ${OUTPUT_DIR}`);
  console.log(`Versions: ${VERSIONS.map(v => v.abbrev).join(', ')}\n`);

  // Allow downloading specific versions via CLI args: node download-bibles.js kjv bbe asv
  const args = process.argv.slice(2);
  const toDownload = args.length > 0
    ? VERSIONS.filter(v =>
        args.includes(v.id) ||
        args.includes(v.abbrev.toLowerCase()) ||
        (v.filename && args.includes(v.filename))
      )
    : VERSIONS;

  if (toDownload.length === 0) {
    console.error('No matching versions found. Available:', VERSIONS.map(v => v.id).join(', '));
    process.exit(1);
  }

  for (const version of toDownload) {
    const outputPath = join(OUTPUT_DIR, `${version.filename || version.id}.json`);

    if (existsSync(outputPath)) {
      const { size } = await import('fs').then(m => m.promises.stat(outputPath));
      if (size > 1000) {
        console.log(`\nSkipping ${version.abbrev} — already downloaded (${(size / 1024 / 1024).toFixed(1)} MB). Pass --force to re-download.`);
        if (!process.argv.includes('--force')) continue;
      }
    }

    try {
      const data = await downloadVersion(version);
      const json = JSON.stringify(data);
      writeFileSync(outputPath, json, 'utf8');
      console.log(`  Saved: ${outputPath} (${(json.length / 1024 / 1024).toFixed(1)} MB)`);
    } catch (err) {
      console.error(`  ERROR downloading ${version.abbrev}: ${err.message}`);
    }
  }

  console.log('\nAll done! Run "npm run dev" to start the app.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
