const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const IS_WIN = process.platform === 'win32';
const DEV_URL_FILE = path.join(ROOT, 'dist-electron', '.dev-server-url');

function findCli(label, candidates) {
  for (const rel of candidates) {
    const full = path.join(ROOT, rel);
    if (fs.existsSync(full)) return full;
  }
  throw new Error(
    `Could not locate ${label} CLI. Tried: ${candidates.map(c => path.join(ROOT, c)).join(', ')}`
  );
}

const VITE_CLI = findCli('Vite', [
  'node_modules/vite/bin/vite.js',
]);
const TSC_CLI = findCli('TypeScript', [
  'node_modules/typescript/bin/tsc',
  'node_modules/typescript/lib/tsc.js',
]);
const ELECTRON_CLI = findCli('Electron', [
  'node_modules/electron/cli.js',
]);

function spawnNode(cliPath, args = [], options = {}) {
  return spawn(process.execPath, [cliPath, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    ...options,
  });
}

function runNode(cliPath, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnNode(cliPath, args, options);

    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(cliPath)} exited with code ${code}`));
    });
  });
}

function waitForDevUrlFile(timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();

    const check = () => {
      try {
        if (fs.existsSync(DEV_URL_FILE)) {
          const content = fs.readFileSync(DEV_URL_FILE, 'utf8').trim();
          if (content) return resolve(content);
        }
      } catch {
        // ignore and retry until timeout
      }

      if (Date.now() - started >= timeoutMs) {
        return reject(new Error('Timed out waiting for Vite dev server URL file.'));
      }

      setTimeout(check, 250);
    };

    check();
  });
}

function killChild(child) {
  if (!child || child.killed) return;

  if (IS_WIN) {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.on('error', () => {
      try { child.kill(); } catch {}
    });
    return;
  }

  try { child.kill('SIGTERM'); } catch {}
}

async function main() {
  let viteChild = null;
  let electronChild = null;

  const cleanup = () => {
    killChild(electronChild);
    killChild(viteChild);
  };

  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });

  try {
    // Avoid reusing a stale URL from a previous run.
    try { fs.unlinkSync(DEV_URL_FILE); } catch { /* ignore */ }

    // Start Vite first (writes dist-electron/.dev-server-url once listening).
    viteChild = spawnNode(VITE_CLI, ['--port=3000', '--host=0.0.0.0']);
    viteChild.on('error', err => {
      console.error(`[electron:dev] Failed to start Vite: ${err.message}`);
      process.exit(1);
    });

    const devUrl = await waitForDevUrlFile();
    console.log(`[electron:dev] Vite ready at ${devUrl}`);

    // Mirror npm script behavior: ensure dist-electron is commonjs.
    fs.mkdirSync(path.join(ROOT, 'dist-electron'), { recursive: true });
    fs.writeFileSync(
      path.join(ROOT, 'dist-electron', 'package.json'),
      '{"type":"commonjs"}'
    );

    await runNode(TSC_CLI, ['--project', 'tsconfig.electron.json']);

    electronChild = spawnNode(ELECTRON_CLI, ['.'], {
      env: { ...process.env, NODE_ENV: 'development' },
    });

    electronChild.on('error', err => {
      console.error(`[electron:dev] Failed to start Electron: ${err.message}`);
      cleanup();
      process.exit(1);
    });

    electronChild.on('exit', code => {
      cleanup();
      process.exit(code ?? 0);
    });
  } catch (err) {
    console.error(`[electron:dev] ${err.message}`);
    cleanup();
    process.exit(1);
  }
}

main();
