// Always-on development supervisor: restart the HTTP worker when server.cjs changes.
// Browser-side changes are handled by the worker's SSE live-reload endpoint.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const serverFile = path.join(__dirname, 'server.cjs');
let worker = null;
let restartTimer = null;
let restarting = false;
let stopping = false;

function startWorker() {
  if (stopping) return;
  console.log('[writer] starting server');
  worker = spawn(process.execPath, [serverFile], {
    cwd: __dirname,
    env: process.env,
    stdio: 'inherit'
  });
  worker.on('error', err => console.error('[writer] server process error:', err.message));
  worker.on('exit', (code, signal) => {
    worker = null;
    if (stopping) return;
    if (restarting) {
      restarting = false;
      setTimeout(startWorker, 250);
      return;
    }
    console.error(`[writer] server exited (code ${code}, signal ${signal || 'none'}); waiting for a server.cjs edit to retry`);
  });
}

function requestRestart() {
  if (stopping || restartTimer) return;
  console.log('[writer] server.cjs changed; restarting server shortly');
  // Give connected editors time to save before their SSE connection drops.
  restartTimer = setTimeout(() => {
    restartTimer = null;
    const check = spawnSync(process.execPath, ['--check', serverFile], { encoding: 'utf8' });
    if (check.status !== 0) {
      console.error('[writer] server has a syntax error; keeping the current worker until the next edit');
      console.error(check.stderr || check.error?.message || 'syntax check failed');
      return;
    }
    if (!worker) { startWorker(); return; }
    restarting = true;
    worker.kill();
  }, 1500);
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearTimeout(restartTimer);
  fs.unwatchFile(serverFile);
  if (worker) worker.kill();
  setTimeout(() => process.exit(code), 100);
}

fs.watchFile(serverFile, { interval: 400, persistent: true }, (current, previous) => {
  if (current.mtimeMs !== previous.mtimeMs || current.size !== previous.size) requestRestart();
});
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
startWorker();
