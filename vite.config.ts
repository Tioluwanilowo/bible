import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

/**
 * Vite plugin: once the dev server is listening, write the actual URL
 * (e.g. "http://localhost:3001") to dist-electron/.dev-server-url so the
 * Electron main process can load the correct port without it being hardcoded.
 */
function writeDevServerUrl() {
  return {
    name: 'write-dev-server-url',
    configureServer(server: any) {
      server.httpServer?.once('listening', () => {
        const addr = server.httpServer.address();
        const port = typeof addr === 'object' && addr ? addr.port : 3000;
        const url = `http://localhost:${port}`;
        fs.mkdirSync('dist-electron', { recursive: true });
        fs.writeFileSync('dist-electron/.dev-server-url', url, 'utf8');
        console.log(`[vite] dev server URL → ${url} (written to dist-electron/.dev-server-url)`);
      });
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    // Relative paths in production so Electron's file:// protocol resolves
    // all assets correctly.  Dev server keeps '/' so HMR works normally.
    base: mode === 'production' ? './' : '/',
    plugins: [react(), tailwindcss(), writeDevServerUrl()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Allow Electron's offscreen renderer (and all local connections) to reach Vite.
      // Vite 6 added strict host validation that blocks unusual origins like
      // Electron's offscreen BrowserWindow renderer process.
      allowedHosts: true,
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          live: path.resolve(__dirname, 'live.html'),
        },
      },
    },
  };
});
