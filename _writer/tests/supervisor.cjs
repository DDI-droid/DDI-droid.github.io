// Isolated supervisor test: only temporary fixture files/processes are changed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'writer-supervisor-'));
  fs.copyFileSync(path.join(__dirname, '../dev.cjs'), path.join(dir, 'dev.cjs'));
  const file = path.join(dir, 'server.cjs');
  const worker = label => `console.log('${label}'); setInterval(() => {}, 1000);\n`;
  fs.writeFileSync(file, worker('ready-one'));
  const dev = spawn(process.execPath, [path.join(dir, 'dev.cjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  dev.stdout.on('data', data => { output += data; });
  dev.stderr.on('data', data => { output += data; });
  const wait = async text => {
    const until = Date.now() + 12000;
    while (!output.includes(text)) {
      if (Date.now() > until) throw new Error('Timed out waiting for ' + text + '\n' + output);
      await delay(50);
    }
  };
  try {
    await wait('ready-one');
    fs.writeFileSync(file, 'const = invalid;\n');
    await wait('keeping the current worker');
    assert.equal(dev.exitCode, null);
    fs.writeFileSync(file, worker('ready-two'));
    await wait('ready-two');
    fs.writeFileSync(file, "throw new Error('simulated runtime failure');\n");
    await wait('waiting for a server.cjs edit to retry');
    fs.writeFileSync(file, worker('ready-three'));
    await wait('ready-three');
    console.log('PASS: supervisor survives invalid syntax, restarts corrected code, and recovers after a worker crash.');
  } finally {
    dev.kill('SIGTERM');
    await new Promise(resolve => dev.once('exit', resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
