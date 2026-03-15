const fs = require('fs');
const path = require('path');
const https = require('https');

const versions = [
  { id: 'kjv', url: 'https://raw.githubusercontent.com/thiagobodruk/bible/master/json/en_kjv.json' },
  { id: 'bbe', url: 'https://raw.githubusercontent.com/thiagobodruk/bible/master/json/en_bbe.json' }
];

const dataDir = path.join(__dirname, '../src/data/bibles');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

async function downloadAndFormat(version) {
  return new Promise((resolve, reject) => {
    https.get(version.url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (data.charCodeAt(0) === 0xFEFF) {
            data = data.slice(1);
          }
          const rawData = JSON.parse(data);
          const formatted = {
            version: version.id.toUpperCase(),
            books: {}
          };

          rawData.forEach(book => {
            const bookName = book.name;
            formatted.books[bookName] = {};
            
            book.chapters.forEach((chapter, chapterIdx) => {
              const chapterNum = (chapterIdx + 1).toString();
              formatted.books[bookName][chapterNum] = {};
              
              chapter.forEach((verse, verseIdx) => {
                const verseNum = (verseIdx + 1).toString();
                formatted.books[bookName][chapterNum][verseNum] = verse;
              });
            });
          });

          fs.writeFileSync(
            path.join(dataDir, `${version.id}.json`),
            JSON.stringify(formatted, null, 2)
          );
          console.log(`Successfully downloaded and formatted ${version.id.toUpperCase()}`);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  for (const v of versions) {
    await downloadAndFormat(v);
  }
}

main().catch(console.error);
