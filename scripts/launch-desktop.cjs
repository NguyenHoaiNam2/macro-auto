const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const electronPath = require('electron');

// Without VITE_DEV_SERVER_URL, main.cjs loads dist/index.html — guard against a stale build.
if (!fs.existsSync(path.join(__dirname, '..', 'dist', 'index.html'))) {
  console.error('[desktop] dist/index.html is missing — run `npm run build` first.');
  process.exit(1);
}

const electron = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env },
  windowsHide: false,
});

electron.on('close', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
