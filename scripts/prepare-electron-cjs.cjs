const fs = require('fs');
const path = require('path');

const distElectronDir = path.join(process.cwd(), 'dist-electron');
const packageJsonPath = path.join(distElectronDir, 'package.json');

fs.mkdirSync(distElectronDir, { recursive: true });
fs.writeFileSync(packageJsonPath, '{"type":"commonjs"}\n', 'utf8');
console.log(`[prepare-electron-cjs] Wrote ${packageJsonPath}`);
