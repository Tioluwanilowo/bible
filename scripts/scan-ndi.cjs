/**
 * scan-ndi.cjs — NDI source scanner
 * Run: node scripts/scan-ndi.cjs
 *
 * NOTE: grandiose.find() only fires when the NDI source LIST CHANGES.
 * So this script creates its own test sender first, which forces a list
 * change and lets us see ALL currently active sources including ScriptureFlow.
 */

const path = require('path');
const fs   = require('fs');

// Inject NDI 6 runtime into PATH before loading grandiose
const NDI6_RUNTIME = 'C:\\Program Files\\NDI\\NDI 6 Tools\\Runtime';
if (fs.existsSync(NDI6_RUNTIME)) {
  process.env.PATH = NDI6_RUNTIME + ';' + (process.env.PATH || '');
  console.log('[NDI] Injected NDI 6 Tools Runtime into PATH');
}

// Load grandiose from production install (v3 DLL removed, uses NDI v6)
const PROD_BIN = 'C:\\Program Files\\ScriptureFlow\\resources\\app.asar.unpacked\\node_modules\\grandiose\\build\\Release\\grandiose.node';
const DEV_PKG  = path.join(__dirname, '../node_modules/grandiose');

let grandiose;
if (fs.existsSync(PROD_BIN)) {
  try { grandiose = require(PROD_BIN); console.log('[NDI] Using production grandiose (NDI v6)'); } catch(e) {}
}
if (!grandiose) {
  try { grandiose = require(DEV_PKG); console.log('[NDI] Using dev grandiose (NDI v3 — may miss v6 sources)'); } catch(e) {
    console.error('[NDI] Could not load grandiose'); process.exit(1);
  }
}

// Create a test sender so that the NDI source list CHANGES, which allows
// grandiose.find() to pick up ALL current sources (including ScriptureFlow).
let testSender;
try {
  testSender = grandiose.send({ name: '__ScanProbe__', clockVideo: false, clockAudio: false });
  console.log('[NDI] Test sender created — triggering a source list change so find() can see all sources\n');
} catch(e) {
  console.log('[NDI] Could not create test sender:', e.message);
}

console.log('Scanning... (10 seconds)\n');
console.log('> While this runs, check OBS/NDI Tools for "ScriptureFlow" source too.\n');

grandiose.find({ showLocalSources: true, wait: 10000 })
  .then(sources => {
    console.log(`\nFound ${sources.length} NDI source(s):`);
    sources.forEach((s, i) => {
      const tag = s.name && s.name.toLowerCase().includes('scriptureflow') ? '  <-- ScriptureFlow FOUND!' : '';
      console.log(`  [${i+1}] ${s.name}${tag}`);
    });
    const found = sources.some(s => s.name && s.name.toLowerCase().includes('scriptureflow'));
    console.log('');
    console.log(found
      ? '=== SUCCESS: ScriptureFlow NDI output is DISCOVERABLE ==='
      : '=== ScriptureFlow NOT found. Is NDI enabled and streaming in the app? ===');
    process.exit(found ? 0 : 1);
  })
  .catch(err => {
    // find() errors if the list STILL didn't change after wait — shouldn't happen
    // since we created the test sender above. If we get here, NDI is broken.
    console.log('\nNDI find error:', err.message);
    console.log('NDI discovery is not functioning on this machine/runtime.');
    process.exit(1);
  });
