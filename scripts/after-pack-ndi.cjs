/**
 * electron-builder afterPack hook:
 * remove stale bundled NDI v3 DLLs from grandiose so packaged builds
 * resolve the system NDI runtime (v5/v6) instead.
 */
const fs = require('fs');
const path = require('path');

function walkFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

module.exports = async function afterPack(context) {
  const root = path.join(
    context.appOutDir,
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'grandiose'
  );

  const targets = walkFiles(root)
    .filter((f) => path.basename(f).toLowerCase() === 'processing.ndi.lib.x64.dll');

  let removed = 0;
  for (const target of targets) {
    try {
      fs.unlinkSync(target);
      removed += 1;
      console.log(`[afterPack][NDI] Removed stale bundled DLL: ${target}`);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      console.warn(`[afterPack][NDI] Failed to remove ${target}: ${msg}`);
    }
  }

  if (removed === 0) {
    console.log('[afterPack][NDI] No bundled NDI DLL found to remove.');
  }
};
