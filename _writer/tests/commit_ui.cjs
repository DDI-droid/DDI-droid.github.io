// The Commit, GitHub and History controls in a browser, against a disposable site whose remote is a local bare
// repository. Never touches the real site, drafts or GitHub. Usage: node tests/commit_ui.cjs [server file] [out dir]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { chromium } = require('playwright');

const serverFile = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.cjs'));
const outDir = process.argv[3] ? path.resolve(process.argv[3]) : null;
const PORT = 4400 + 80 + (process.pid % 15);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'writer-commit-ui-'));
const site = path.join(tmp, 'site'), remote = path.join(tmp, 'remote.git');
const sh = (args, cwd = site) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (rel, text) => { const f = path.join(site, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };

(async () => {
  sh(['init', '--quiet', '--bare', remote], tmp);
  fs.mkdirSync(site);
  sh(['init', '--quiet', '-b', 'main']);
  sh(['config', 'user.name', 'Test Writer']); sh(['config', 'user.email', 'test@example.invalid']);
  write('_config.yml', 'url: https://example.invalid\n');
  write('_posts/2025-01-01-old-post.md', '---\nlayout: post\ntitle: Old post\ndate: 2025-01-01 12:00:00\n---\n\nOld text.\n');
  sh(['add', '-A']); sh(['commit', '--quiet', '-m', 'start']);
  sh(['remote', 'add', 'origin', remote]); sh(['push', '--quiet', '-u', 'origin', 'main']);
  const server = spawn(process.execPath, [serverFile], { env: { ...process.env, PORT: String(PORT), WRITER_SITE: site,
    WRITER_DRAFTS: path.join(tmp, 'drafts'), WRITER_HISTORY: path.join(tmp, 'history') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  const browser = await chromium.launch({ headless: true,
    ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) });
  const errors = [];
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch('http://127.0.0.1:' + PORT + '/api/drafts')).ok) break; } catch {} await new Promise(r => setTimeout(r, 200)); }
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', err => errors.push(err.message));
    page.on('dialog', d => d.accept('UI Post'));
    await page.goto('http://localhost:' + PORT + '/#old-post');
    await page.locator('#state').filter({ hasText: 'On the site' }).waitFor();

    // A new post shows as not on the site, in the list and next to Commit.
    await page.locator('#new').click();
    await page.locator('#state').filter({ hasText: 'Not on the site' }).waitFor();
    assert.match(await page.locator('#drafts option:checked').innerText(), /UI Post · not on the site/);
    await page.locator('#source').fill('---\ntitle: UI Post\ndate: 2025-05-05\n---\n\nWritten in the browser.\n');
    await page.waitForFunction(() => /Saved/.test(document.querySelector('#status').textContent));

    // Commit: the sheet names the file, takes a message, commits and pushes.
    await page.locator('#commit').click();
    await page.locator('#commit-sheet').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#commit-what').innerText(), 'Adds this post to the site.');
    assert.match(await page.locator('#commit-files').innerText(), /_posts\/2025-05-05-ui-post\.html\s*new/);
    if (outDir) { fs.mkdirSync(outDir, { recursive: true }); await page.screenshot({ path: path.join(outDir, 'commit-sheet.png') }); }
    await page.locator('#commit-msg').fill('Add the UI post');
    await page.locator('#commit-msg').press('Enter');
    await page.locator('#toast').filter({ hasText: 'and pushed' }).waitFor();
    assert.equal(sh(['log', '-1', '--format=%s']).trim(), 'Add the UI post');
    assert.equal(sh(['rev-parse', 'HEAD']), sh(['rev-parse', 'main'], remote));
    await page.locator('#state').filter({ hasText: 'On the site' }).waitFor();
    await page.waitForFunction(() => document.querySelector('#drafts option:checked').textContent === 'UI Post', null, { timeout: 5000 })
      .catch(async () => { throw new Error('list label: ' + JSON.stringify(await page.locator('#drafts').evaluate(s => [...s.options].map(o => [o.textContent, o.dataset.state, o.dataset.title])))); });

    // Editing marks it changed; History restores the committed version and keeps the edit as a version.
    await page.locator('#source').fill('---\ntitle: UI Post\ndate: 2025-05-05\n---\n\nRewritten.\n');
    await page.locator('#state').filter({ hasText: 'Changed' }).waitFor({ timeout: 10000 });
    await page.locator('#history').click();
    await page.locator('#history-list li').filter({ hasText: 'Add the UI post' }).waitFor();
    assert.match(await page.locator('#history-list').innerText(), /Add the UI post/);
    if (outDir) await page.screenshot({ path: path.join(outDir, 'history-sheet.png') });
    const restore = page.locator('#history-list li').filter({ hasText: 'Add the UI post' }).locator('button');
    await restore.click();
    assert.equal(await restore.innerText(), 'Replace the text?');
    await restore.click();
    await page.locator('#toast').filter({ hasText: 'Restored the version' }).waitFor();
    assert.match(await page.locator('#source').inputValue(), /Written in the browser/);
    await page.locator('#state').filter({ hasText: 'On the site' }).waitFor({ timeout: 10000 });
    await page.locator('#history').click();
    await page.locator('#history-list li').filter({ hasText: 'Before restoring' }).waitFor();

    // A failed push keeps the commit here; the GitHub button counts it and its sheet pushes it later.
    await page.keyboard.press('Escape');
    fs.renameSync(remote, remote + '.away');
    await page.locator('#source').fill('---\ntitle: UI Post\ndate: 2025-05-05\n---\n\nOffline change.\n');
    await page.locator('#state').filter({ hasText: 'Changed' }).waitFor({ timeout: 10000 });
    await page.locator('#commit').click();
    await page.locator('#commit-go').click();
    await page.locator('#toast').filter({ hasText: 'not pushed' }).waitFor({ timeout: 30000 });
    await page.locator('#remote').filter({ hasText: 'GitHub ↑1' }).waitFor();
    fs.renameSync(remote + '.away', remote);
    await page.locator('#remote').click();
    await page.locator('#remote-body').filter({ hasText: 'Here, not on GitHub' }).waitFor({ timeout: 30000 });
    assert.equal(await page.locator('#remote-go').innerText(), 'Push');
    await page.locator('#remote-go').click();
    await page.locator('#toast').filter({ hasText: 'In sync with GitHub: pushed 1' }).waitFor({ timeout: 30000 });
    await page.locator('#remote').filter({ hasText: 'GitHub: in sync' }).waitFor();
    assert.equal(sh(['rev-parse', 'HEAD']), sh(['rev-parse', 'main'], remote));

    // A commit made on GitHub: the sheet lists it and pulls it.
    const other = path.join(tmp, 'other');
    sh(['clone', '--quiet', '-b', 'main', remote, other], tmp);
    sh(['config', 'user.name', 'Elsewhere'], other); sh(['config', 'user.email', 'else@example.invalid'], other);
    fs.writeFileSync(path.join(other, 'README.md'), 'from GitHub\n');
    sh(['add', '-A'], other); sh(['commit', '--quiet', '-m', 'Edit on GitHub'], other); sh(['push', '--quiet', 'origin', 'main'], other);
    await page.locator('#remote').click();
    await page.locator('#remote-body').filter({ hasText: 'Edit on GitHub' }).waitFor({ timeout: 30000 });
    assert.match(await page.locator('#remote-body').innerText(), /On GitHub, not here/);
    assert.equal(await page.locator('#remote-go').innerText(), 'Pull');
    if (outDir) await page.screenshot({ path: path.join(outDir, 'remote-sheet.png') });
    await page.locator('#remote-go').click();
    await page.locator('#toast').filter({ hasText: 'pulled 1 commit' }).waitFor({ timeout: 30000 });
    assert.match(fs.readFileSync(path.join(site, 'README.md'), 'utf8'), /^from GitHub\r?\n$/);
    await page.locator('#remote').filter({ hasText: 'GitHub: in sync' }).waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: state badge and list labels, commit sheet (files, message, Enter), commit + push, changed after edits, history restore with snapshot, failed push then push from the GitHub sheet, a GitHub commit listed and pulled.');
  } catch (err) {
    console.error('FAIL:', err.stack || err); console.error(log); process.exitCode = 1;
  } finally {
    await browser.close(); server.kill();
    if (!process.exitCode) fs.rmSync(tmp, { recursive: true, force: true }); else console.error('kept', tmp);
  }
})();
