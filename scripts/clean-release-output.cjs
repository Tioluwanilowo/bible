const fs = require('fs');
const path = require('path');

const root = process.cwd();
const targets = [
  path.join(root, 'release', 'win-unpacked'),
  path.join(root, 'release', 'builder-debug.yml'),
];

for (const target of targets) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`[release-clean] removed ${target}`);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.warn(`[release-clean] could not remove ${target}: ${msg}`);
  }
}
