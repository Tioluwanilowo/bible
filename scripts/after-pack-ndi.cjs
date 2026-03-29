/**
 * electron-builder afterPack hook:
 * prefer bundling a known NDI v6 runtime DLL next to grandiose.node
 * so installed EXEs don't depend on fragile PATH lookup at first launch.
 */
const fs = require('fs');
const path = require('path');

const RUNTIME_DIRS = [
  'C:\\Program Files\\NDI\\NDI 6 Tools\\Runtime',
  'C:\\Program Files\\NDI\\NDI 6 Tools\\Router',
  'C:\\Program Files\\NDI\\NDI 6 Runtime\\v6',
  'C:\\Program Files\\NDI\\NDI 6 Runtime',
  'C:\\Program Files\\NDI\\NDI 5 Runtime',
  'C:\\Program Files\\NewTek\\NewTek NDI Tools',
  'C:\\Program Files\\NewTek\\NDI 4 Runtime\\v4.6',
];

function findRuntimeDll() {
  for (const runtimeDir of RUNTIME_DIRS) {
    const dll = path.join(runtimeDir, 'Processing.NDI.Lib.x64.dll');
    if (fs.existsSync(dll)) return dll;
  }
  return null;
}

module.exports = async function afterPack(context) {
  const root = path.join(
    context.appOutDir,
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'grandiose',
  );

  const targets = [
    path.join(root, 'build', 'Release', 'Processing.NDI.Lib.x64.dll'),
    path.join(root, 'lib', 'win_x64', 'Processing.NDI.Lib.x64.dll'),
  ];

  // grandiose may resolve the addon from bin/win32-x64-*, so keep the runtime
  // DLL beside those native addon directories as well.
  const binRoot = path.join(root, 'bin');
  try {
    if (fs.existsSync(binRoot)) {
      for (const entry of fs.readdirSync(binRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (!entry.name.toLowerCase().startsWith('win32-x64')) continue;
        targets.push(path.join(binRoot, entry.name, 'Processing.NDI.Lib.x64.dll'));
      }
    }
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.warn(`[afterPack][NDI] Could not scan bin directories: ${msg}`);
  }

  const runtimeDll = findRuntimeDll();
  if (!runtimeDll) {
    console.warn('[afterPack][NDI] No system NDI runtime DLL found on build machine; keeping bundled DLL if present.');
    return;
  }

  let copied = 0;
  for (const target of [...new Set(targets)]) {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(runtimeDll, target);
      copied += 1;
      console.log(`[afterPack][NDI] Copied runtime DLL to ${target}`);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      console.warn(`[afterPack][NDI] Failed to copy DLL to ${target}: ${msg}`);
    }
  }

  if (copied === 0) {
    console.warn('[afterPack][NDI] Runtime DLL copy failed for all targets.');
  }
};
