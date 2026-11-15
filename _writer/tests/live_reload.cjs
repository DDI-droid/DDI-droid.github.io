// End-to-end revision/reload tests in a disposable writer, never real drafts/posts.
// Run: node tests/live_reload.cjs. WRITER_TEST_SOURCE optionally selects staged code.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sourceRoot = process.env.WRITER_TEST_SOURCE || path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'writer-live-reload-'));
const writer = path.join(temp, '_writer');
const assets = path.join(temp, 'assets');
const imagePath = path.join(assets, 'img/probe.svg');
const moviePath = path.join(assets, 'media/probe.webm');
const sourceMoviePath = path.join(assets, 'media/source.webm');
const source = '---\ntitle: Reload probe\n---\n\n' +
  '<link rel="stylesheet" href="/assets/probe.css">\n' +
  '<div id="css-probe">Styled asset</div>\n\n' +
  '![Probe](/assets/img/probe.svg)\n\n' +
  '<video id="direct" preload="auto" src="/assets/media/probe.webm"></video>\n\n' +
  '<video id="nested" preload="auto"><source src="/assets/media/source.webm" type="video/webm"></video>\n\n' +
  '<iframe id="document-probe" src="/assets/probe.html"></iframe>\n\n' +
  Array.from({ length: 30 }, (_, i) => 'Paragraph ' + i + ': preserved writing.\n').join('\n');
const svg = width => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="10"><rect width="100%" height="100%" fill="gray"/></svg>`;
for (const dir of [writer, path.join(writer, 'drafts'), path.dirname(imagePath), path.dirname(moviePath)]) fs.mkdirSync(dir, { recursive: true });
for (const name of ['server.cjs', 'render.js']) fs.copyFileSync(path.join(sourceRoot, name), path.join(writer, name));
fs.cpSync(path.join(sourceRoot, 'static'), path.join(writer, 'static'), { recursive: true });
fs.symlinkSync(path.join(sourceRoot, 'node_modules'), path.join(writer, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
fs.writeFileSync(path.join(writer, 'drafts/probe.md'), source);
fs.writeFileSync(imagePath, svg(11));
fs.writeFileSync(path.join(assets, 'probe.css'), '#css-probe { width: 11px; }');
fs.writeFileSync(path.join(assets, 'probe.html'), '<html><body>Document 11</body></html>');
fs.writeFileSync(path.join(assets, 'probe.js'), 'window.fixtureScript = 11;');
const shell = path.join(writer, 'static/shell.html');
fs.writeFileSync(shell, fs.readFileSync(shell, 'utf8').replace('</head>', '<script src="/assets/probe.js"></script></head>'));
// No native notification can make this test pass by accident.
const preload = path.join(temp, 'no-native-watch.cjs');
fs.writeFileSync(preload, "require('node:fs').watch = () => { throw new Error('native notifications disabled by regression test'); };\n");

(async () => {
  const socket = http.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let log = '', server, browser;
  try {
    browser = await chromium.launch({ headless: true,
      ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) });
    const encoder = await browser.newPage();
    async function video(width) {
      return Buffer.from(await encoder.evaluate(async width => {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = 48;
        document.body.append(canvas);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'gray'; ctx.fillRect(0, 0, width, 48);
        const stream = canvas.captureStream(0);
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
        const chunks = [];
        const done = new Promise(resolve => { recorder.ondataavailable = e => chunks.push(e.data); recorder.onstop = resolve; });
        recorder.start();
        let frame = 0;
        const timer = setInterval(() => {
          ctx.fillStyle = frame++ % 2 ? '#777777' : '#888888'; ctx.fillRect(0, 0, width, 48);
          stream.getVideoTracks()[0].requestFrame();
        }, 50);
        await new Promise(resolve => setTimeout(resolve, 1000));
        recorder.stop(); await done; clearInterval(timer); stream.getTracks().forEach(track => track.stop()); canvas.remove();
        const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
        return btoa(String.fromCharCode(...bytes));
      }, width), 'base64');
    }
    // Warm up Chrome's headless capture pipeline before recording fixture files.
    await video(32);
    const movie64 = await video(64), movie96 = await video(96);
    assert.ok(movie64.length > 200 && movie96.length > 200, 'video fixtures must contain encoded frames');
    await encoder.close();
    fs.writeFileSync(moviePath, movie64); fs.writeFileSync(sourceMoviePath, movie64);
    server = spawn(process.execPath, ['--require', preload, path.join(writer, 'server.cjs')], {
      env: { ...process.env, PORT: String(port), WRITER_SITE: temp }, stdio: ['ignore', 'pipe', 'pipe']
    });
    server.stdout.on('data', b => { log += b; }); server.stderr.on('data', b => { log += b; });
    for (let i = 0; ; i++) {
      try { if ((await fetch(base + '/_writer/bridge.js')).ok) break; } catch (_) {}
      if (i > 100 || server.exitCode !== null) throw new Error('server startup failed: ' + log);
      await delay(50);
    }
    const context = await browser.newContext();
    const errors = [];
    context.on('page', page => page.on('pageerror', err => errors.push(err.message)));
    await context.addInitScript(() => {
      const Native = window.EventSource;
      window.fixtureStreams = [];
      window.EventSource = class extends Native {
        constructor(...args) { super(...args); window.fixtureStreams.push(this); }
      };
    });
    await context.route('**/tex-mml-chtml.js', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    const editor = await context.newPage();
    await editor.goto(base + '/#probe', { waitUntil: 'domcontentloaded' });
    const tab = await context.newPage();
    await tab.goto(base + '/preview?slug=probe', { waitUntil: 'domcontentloaded' });
    const embedded = () => editor.frame({ url: /\/preview/ });
    const waitImage = async (page, width) => {
      try { await page.waitForFunction(width => document.querySelector('#markdown-content img')?.naturalWidth === width, width, { timeout: 10000 }); }
      catch (err) {
        console.error('Image diagnostic:', await page.evaluate(() => ({ url: location.href, online: navigator.onLine,
          baseline: window.__writerLiveState, streams: window.fixtureStreams?.map(stream => stream.readyState),
          src: document.querySelector('#markdown-content img')?.src, width: document.querySelector('#markdown-content img')?.naturalWidth,
          text: document.body.innerText.slice(0, 400) })), 'server:', log);
        throw err;
      }
    };
    const waitVideo = async (page, selector, width) => {
      try { await page.waitForFunction(({ selector, width }) => document.querySelector(selector)?.videoWidth === width,
        { selector, width }, { timeout: 10000 }); }
      catch (err) {
        console.error('Video diagnostic:', await page.evaluate(selector => {
          const video = document.querySelector(selector);
          return video && { src: video.currentSrc, width: video.videoWidth, readyState: video.readyState,
            networkState: video.networkState, error: video.error && { code: video.error.code, message: video.error.message }, html: video.outerHTML };
        }, selector), 'encoded bytes:', movie64.length, movie96.length, 'server:', log);
        throw err;
      }
    };
    await waitImage(tab, 11); await waitVideo(tab, '#direct', 64); await waitVideo(tab, '#nested', 64);
    await waitImage(embedded(), 11);
    let editorNavigations = 0;
    editor.on('framenavigated', frame => { if (frame === editor.mainFrame()) editorNavigations++; });
    // Keep genuinely unsaved writing in memory while resources change.
    await context.route('**/api/drafts/probe', async route => {
      if (route.request().method() === 'PUT') return route.fulfill({ status: 503, body: 'temporary test save failure' });
      return route.continue();
    });
    const unsaved = source + '\nUnsaved text survives all asset updates.\n';
    await editor.locator('#source').fill(unsaved);
    await editor.locator('#source').evaluate(ta => { ta.setSelectionRange(20, 24); ta.scrollTop = 100; });
    await tab.locator('#markdown-content').filter({ hasText: 'Unsaved text survives' }).waitFor();
    // Same URL, same size, original mtime: ctime/inode still identify replacement.
    const old = fs.statSync(imagePath);
    fs.writeFileSync(imagePath, svg(22)); fs.utimesSync(imagePath, old.atime, old.mtime);
    await waitImage(tab, 22); await waitImage(embedded(), 22);
    assert.match(await tab.locator('#markdown-content').innerText(), /Unsaved text survives/);
    console.log('PASS: image overwrite with missed native notifications and restored mtime');
    // Real decoded videos live outside assets/img. Both src forms use the same reload path.
    fs.writeFileSync(moviePath + '.tmp', movie96); fs.renameSync(moviePath + '.tmp', moviePath);
    fs.writeFileSync(sourceMoviePath, movie96);
    await waitVideo(tab, '#direct', 96); await waitVideo(tab, '#nested', 96);
    await waitVideo(embedded(), '#direct', 96); await waitVideo(embedded(), '#nested', 96);
    console.log('PASS: atomic video replacement + nested source video, decoded new dimensions');
    fs.writeFileSync(path.join(assets, 'probe.css'), '#css-probe { width: 22px; }');
    fs.writeFileSync(path.join(assets, 'probe.js'), 'window.fixtureScript = 22;');
    fs.writeFileSync(path.join(assets, 'probe.html'), '<html><body>Document 22</body></html>');
    await tab.waitForFunction(() => window.fixtureScript === 22 && getComputedStyle(document.querySelector('#css-probe')).width === '22px');
    await tab.frameLocator('#document-probe').locator('body').filter({ hasText: 'Document 22' }).waitFor();
    console.log('PASS: stylesheet, script and embedded-document assets use that same path');
    // Miss ALL stream messages in this tab, then reconcile the current server state on focus.
    await tab.evaluate(() => window.fixtureStreams.forEach(stream => stream.close()));
    fs.writeFileSync(imagePath, svg(33));
    await waitImage(embedded(), 33);
    assert.equal(await tab.locator('#markdown-content img').evaluate(img => img.naturalWidth), 22);
    await tab.evaluate(() => window.dispatchEvent(new Event('focus')));
    await waitImage(tab, 33);
    console.log('PASS: focus reconciliation catches missed stream updates');
    // Offline stream reconnection also compares a full state, not just future deltas.
    await context.setOffline(true); await delay(900);
    fs.writeFileSync(imagePath, svg(44)); await delay(1000);
    await context.setOffline(false);
    await waitImage(tab, 44); await waitImage(embedded(), 44);
    console.log('PASS: reconnect catches changes made offline');
    // Deletion remains tracked, so later recreation does not need a directory event.
    fs.unlinkSync(imagePath); await delay(1200);
    fs.writeFileSync(imagePath, svg(55));
    await waitImage(tab, 55); await waitImage(embedded(), 55);
    // Changes during a slow first render are compared against the document baseline.
    const cold = await context.newPage();
    await cold.addInitScript(() => { window.BroadcastChannel = class { postMessage() {} close() {} }; });
    await cold.route('**/api/preview/probe', async route => { await delay(1400); try { await route.continue(); } catch (_) {} });
    await cold.goto(base + '/preview?slug=probe', { waitUntil: 'domcontentloaded' });
    fs.writeFileSync(imagePath, svg(66));
    await waitImage(cold, 66); await waitImage(tab, 66); await waitImage(embedded(), 66);
    await cold.close();
    assert.ok(!(await tab.locator('#markdown-content img').getAttribute('src')).includes('_writerAsset'), 'no per-image cache-busting workaround');
    const beforeBurst = await (await fetch(base + '/_writer/state')).json();
    for (const width of [71, 72, 73, 74, 77]) { fs.writeFileSync(imagePath, svg(width)); await delay(60); }
    await waitImage(tab, 77); await waitImage(embedded(), 77);
    const afterBurst = await (await fetch(base + '/_writer/state')).json();
    assert.equal(afterBurst.assets, beforeBurst.assets + 1, 'coalesce a burst into one settled revision');
    console.log('PASS: slow initial-render race and coalesced writes, without per-image URL rewriting');
    assert.equal(editorNavigations, 0, 'asset revisions must not navigate the editor');
    assert.equal(await editor.locator('#source').inputValue(), unsaved);
    assert.deepEqual(await editor.locator('#source').evaluate(ta => [ta.selectionStart, ta.selectionEnd]), [20, 24]);
    assert.equal(await editor.locator('#source').evaluate(ta => ta.scrollTop), 100);
    assert.match(await tab.locator('#markdown-content').innerText(), /Unsaved text survives/);
    // Native undo stack still belongs to the same textarea/document.
    await editor.locator('#source').focus(); await editor.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    assert.notEqual(await editor.locator('#source').inputValue(), unsaved, 'undo must still work');
    assert.deepEqual(errors, []);
    const state = await (await fetch(base + '/_writer/state')).json();
    assert.ok(state.assets > 0); assert.equal(state.tools, 0);
    console.log('PASS: delete/recreate, unsaved text, selection, scroll and undo preserved; no editor navigation or page errors');
    console.log('Reload trace:', log.trim());
  } finally {
    if (browser) await browser.close();
    if (server) { server.kill(); if (server.exitCode === null) await new Promise(resolve => server.once('exit', resolve)); }
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
