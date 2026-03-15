/**
 * import-translations.mjs
 *
 * Converts per-book JSON files from the bible-translations-master dataset
 * into the single-file format used by ScriptureFlow's bibleEngine.
 *
 * Source format (one file per book):
 *   { "Info": { "Translation": "NIV", ... }, "BookName": { "1": { "1": "verse" } } }
 *
 * Output format (one file per translation):
 *   { "version": "NIV", "name": "New International Version", "books": { "BookName": { ... } } }
 *
 * Usage:
 *   node scripts/import-translations.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');

const TRANSLATIONS = [
  {
    id: 'niv',
    name: 'New International Version',
    srcDir: 'C:/Users/Tioluwani/Downloads/bible-translations-master/bible-translations-master/NIV/NIV_books',
  },
  {
    id: 'nlt',
    name: 'New Living Translation',
    srcDir: 'C:/Users/Tioluwani/Downloads/bible-translations-master/bible-translations-master/NLT/NLT_books',
  },
];

function convertTranslation({ id, name, srcDir }) {
  if (!fs.existsSync(srcDir)) {
    console.error(`Source directory not found: ${srcDir}`);
    return false;
  }

  const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.json'));
  console.log(`\n${id.toUpperCase()}: found ${files.length} book files`);

  const books = {};

  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(srcDir, file), 'utf8'));

    // Each file has "Info" key + one book key — find the book key
    for (const [key, value] of Object.entries(raw)) {
      if (key === 'Info') continue;

      // Strip any stray quote characters from verse text
      const cleanedChapters = {};
      for (const [chNum, verses] of Object.entries(value)) {
        cleanedChapters[chNum] = {};
        for (const [vNum, text] of Object.entries(verses)) {
          cleanedChapters[chNum][vNum] = String(text).replace(/^[""\u201C\u201D]+|[""\u201C\u201D]+$/g, '').trim();
        }
      }

      books[key] = cleanedChapters;
    }
  }

  const totalVerses = Object.values(books)
    .flatMap(chs => Object.values(chs))
    .flatMap(vs => Object.values(vs)).length;

  const output = {
    version: id.toUpperCase(),
    name,
    books,
  };

  const outPath = path.join(PROJECT_ROOT, 'public', 'bibles', `${id}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output));

  const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
  console.log(`  ✔ Written: ${outPath}`);
  console.log(`  ✔ Books: ${Object.keys(books).length}, Verses: ${totalVerses.toLocaleString()}, Size: ${sizeMB} MB`);
  return true;
}

let success = 0;
for (const t of TRANSLATIONS) {
  if (convertTranslation(t)) success++;
}

console.log(`\nDone: ${success}/${TRANSLATIONS.length} translations imported.`);
