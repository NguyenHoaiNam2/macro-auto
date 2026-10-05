// Dev orchestrator: Vite Dev Server API (respects vite.config.ts HMR settings) + Electron
// spawned via child_process. Auto-restarts Electron when files in electron/ change (nodemon
// replacement, zero new dependencies).
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const electronPath = require('electron');

let electronProc = null;
let restarting = false;
let restartTimer = null;

function startElectron(devServerUrl) {
  electronProc = spawn(electronPath, ['.'], {
    cwd: root,
    env: { ...process.env, VITE_DEV_SERVER_URL: devServerUrl },
    stdio: 'inherit',
    windowsHide: false,
  });
  electronProc.on('close', (code) => {
    // A scheduled restart kills the old process itself; ignore that exit.
    if (restarting) return;
    process.exit(code ?? 0);
  });
}

function restartElectron(devServerUrl) {
  restarting = true;
  if (electronProc && !electronProc.killed) electronProc.kill();
  setTimeout(() => {
    startElectron(devServerUrl);
    restarting = false;
  }, 200);
}

async function main() {
  // Vite 8 is ESM-only; dynamic import is the CJS-safe way in.
  const { createServer } = await import('vite');
  const server = await createServer({ root });
  await server.listen();
  server.printUrls();

  const devServerUrl = server.resolvedUrls?.local?.[0] || 'http://localhost:5173';
  startElectron(devServerUrl);

  fs.watch(path.join(root, 'electron'), (_event, filename) => {
    if (!filename || !filename.endsWith('.cjs')) return;
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      console.log(`[dev] ${filename} changed — restarting Electron...`);
      restartElectron(devServerUrl);
    }, 150);
  });

  const shutdown = () => {
    if (electronProc && !electronProc.killed) electronProc.kill();
    void server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('exit', () => {
    if (electronProc && !electronProc.killed) electronProc.kill();
  });
}

main().catch((error) => {
  console.error('Unable to start desktop development mode:', error);
  process.exit(1);
});

