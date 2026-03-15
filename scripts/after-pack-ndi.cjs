/**
 * electron-builder afterPack hook:
 * remove stale bundled NDI v3 DLLs from grandiose so packaged builds
 * resolve the system NDI runtime (v5/v6) instead.
 */
const fs = require('fs');
const path = require('path');

function removeIfExists(filePath) {
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

module.exports = async function afterPack(context) {
  const root = path.join(
    context.appOutDir,
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'grandiose'
  );

  const targets = [
    path.join(root, 'build', 'Release', 'Processing.NDI.Lib.x64.dll'),
    path.join(root, 'lib', 'win_x64', 'Processing.NDI.Lib.x64.dll'),
  ];

  let removed = 0;
  for (const target of targets) {
    try {
      if (removeIfExists(target)) {
        removed += 1;
        console.log(`[afterPack][NDI] Removed stale bundled DLL: ${target}`);
      }
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      console.warn(`[afterPack][NDI] Failed to remove ${target}: ${msg}`);
    }
  }

  if (removed === 0) {
    console.log('[afterPack][NDI] No bundled NDI DLL found to remove.');
  }
};
