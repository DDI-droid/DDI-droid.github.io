// Regression checks with intercepted draft/publish APIs: never writes or publishes real drafts.
// Start the writer, then: node tests/maintenance.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { render } = require('../render.js');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {}) });
  const context = await browser.newContext();
  const errors = [];
  const imageName = 'writer-regression-' + process.pid + '.svg';
  const imageFile = path.join(__dirname, '../../assets/img', imageName);
  const image = width => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="10"><rect width="100%" height="100%" fill="red"/></svg>`;
  fs.writeFileSync(imageFile, image(11));
  context.on('page', page => page.on('pageerror', err => errors.push(err.message)));
  const drafts = { 'maintenance-a': '---\ntitle: Preview A\ndate: 2026-10-21\n---\n\nFirst draft.\n',
    'maintenance-b': '---\ntitle: Preview B\n---\n\nSecond draft.\n' };
  drafts['maintenance-a'] += '\nMath: $x^2$.\n\n![Asset regression](/assets/img/' + imageName + ')\n';
  let published = null, failSaves = false;
  await context.route('**/api/drafts', route => route.fulfill({ json: Object.keys(drafts).map(slug => ({ slug, title: slug })) }));
  await context.route('**/api/drafts/*', async route => {
    const slug = route.request().url().split('/').pop();
    if (route.request().method() === 'PUT') {
      await delay(1000);
      if (failSaves) return route.fulfill({ status: 500, body: 'simulated save failure' });
      drafts[slug] = route.request().postData();
      return route.fulfill({ json: { saved: Date.now() } });
    }
    return route.fulfill({ body: drafts[slug], contentType: 'text/plain' });
  });
  await context.route('**/api/preview/*', route => {
    const slug = route.request().url().split('/').pop();
    return route.fulfill({ json: render(drafts[slug], { sourceLines: true }) });
  });
  await context.route('**/api/status/*', route => {
    const slug = route.request().url().split('/').pop();
    return route.fulfill({ json: { slug, title: slug, state: 'new', files: [], ahead: 0 } });
  });
  await context.route('**/api/commit/*', route => {
    const slug = route.request().url().split('/').pop();
    published = { slug, source: drafts[slug] };
    return route.fulfill({ json: { commit: 'abc1234', pushed: true, url: '/test/', site: 'https://example.invalid/test/' } });
  });
  // Stub the external engine to test deferred-script ordering without network dependence.
  await context.route('**/tex-mml-chtml.js', async route => {
    await delay(1800);
    await route.fulfill({ contentType: 'application/javascript', body: `window.MathJax = {
      startup: { promise: Promise.resolve() }, typesetClear() {},
      async typesetPromise(nodes) { nodes[0].dataset.mathTypeset = 'yes'; }
    };` });
  });
  // Force the preview bridge to announce itself before editor.js installs its listener.
  await context.route('**/_writer/editor.js', async route => { await delay(1100); await route.continue(); });
  const page = await context.newPage();
  const frame = page.frameLocator('#preview');
  try {
    await page.goto('http://localhost:4400/#maintenance-a');
    await frame.locator('.post-title').filter({ hasText: 'Preview A' }).waitFor();
    assert.match(await frame.locator('#markdown-content').innerText(), /First draft/);
    await frame.locator('#markdown-content[data-math-typeset="yes"]').waitFor();
    for (let i = 0; i < 3; i++) {
      await page.reload();
      await frame.locator('.post-title').filter({ hasText: 'Preview A' }).waitFor();
      assert.match(await frame.locator('.post-readtime').innerText(), /1 min/);
    }
    const popupPromise = page.waitForEvent('popup');
    await page.locator('#open').click();
    const popup = await popupPromise;
    await popup.locator('.post-title').filter({ hasText: 'Preview A' }).waitFor();
    assert.match(popup.url(), /slug=maintenance-a/);
    await popup.waitForFunction(() => document.querySelector('#markdown-content img')?.naturalWidth === 11);
    fs.writeFileSync(imageFile, image(22));
    await popup.waitForFunction(() => document.querySelector('#markdown-content img')?.naturalWidth === 22);
    await popup.reload();
    await popup.locator('.post-title').filter({ hasText: 'Preview A' }).waitFor();
    const legacy = await context.newPage();
    await legacy.goto('http://localhost:4400/preview');
    await legacy.locator('.post-title').filter({ hasText: 'Preview A' }).waitFor();
    assert.match(legacy.url(), /slug=maintenance-a/);
    await legacy.close();
    await page.locator('#source').fill(drafts['maintenance-a'] + '\nLive edit before autosave.\n');
    await popup.locator('#markdown-content').filter({ hasText: 'Live edit before autosave' }).waitFor();
    await page.locator('#commit').click();
    await page.locator('#commit-go').click();
    await page.waitForFunction(() => document.querySelector('#commit-sheet').hidden && !document.querySelector('#commit-go').disabled);
    assert.match(published.source, /Live edit before autosave/);
    await page.locator('#source').fill(drafts['maintenance-a'] + '\nSaved during switch.\n');
    await page.locator('#drafts').selectOption('maintenance-b');
    await frame.locator('.post-title').filter({ hasText: 'Preview B' }).waitFor();
    assert.match(drafts['maintenance-a'], /Saved during switch/);
    assert.equal(await frame.locator('time').innerText(), '');
    assert.match(await page.locator('#open').getAttribute('href'), /maintenance-b/);
    failSaves = true;
    await page.locator('#source').fill(drafts['maintenance-b'] + '\nDo not lose this.\n');
    await page.locator('#commit').click();
    await page.waitForFunction(() => !document.querySelector('#commit').disabled);
    assert.equal(await page.locator('#commit-sheet').isHidden(), true, 'failed save must not open the commit sheet');
    assert.equal(published.slug, 'maintenance-a', 'failed save must prevent committing');
    assert.match(await page.locator('#source').inputValue(), /Do not lose this/);
    failSaves = false;
    // Reload through the real SSE watcher and verify dirty content is flushed first.
    const css = path.join(__dirname, '../static/editor.css');
    const stat = fs.statSync(css);
    await page.locator('#source').evaluate(ta => ta.setSelectionRange(20, 24));
    const reloaded = page.waitForEvent('load');
    fs.utimesSync(css, stat.atime, new Date());
    await reloaded;
    await frame.locator('#markdown-content').filter({ hasText: 'Do not lose this' }).waitFor();
    assert.match(drafts['maintenance-b'], /Do not lose this/);
    assert.equal(await page.locator('#source').evaluate(ta => ta.selectionStart), 20);
    assert.equal(await page.locator('#source').evaluate(ta => ta.selectionEnd), 24);
    await page.close();
    await popup.reload();
    await popup.locator('.post-title').filter({ hasText: 'Preview A' }).waitFor();
    assert.match(await popup.locator('#markdown-content').innerText(), /Saved during switch/);
    assert.deepEqual(errors, []);
    console.log('PASS: early-ready race, 3 refreshes, preview tab + refresh + live edits + opener closed, slow-save publishing, safe draft switching, missing-date reset, failed-save protection, SSE reload preserves writing, regenerated images refresh automatically, delayed MathJax initialization.');
  } finally { await browser.close(); fs.rmSync(imageFile, { force: true }); }
})().catch(err => { console.error(err); process.exitCode = 1; });
