// Screenshot the writer with a draft open: node tests/shot_editor.cjs <slug> <out.png> [previewFull.png]
const playwright = require('../../node_modules/playwright');
(async () => {
  const [slug, out, full] = process.argv.slice(2);
  const browser = await playwright.chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1536, height: 864 }, deviceScaleFactor: 1.25 });
  const errors = [];
  page.on('pageerror', e => errors.push('editor: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('http://localhost:4400/#' + slug);
  const frame = await (await page.waitForSelector('#preview')).contentFrame();
  frame.on && frame.page().on('pageerror', e => errors.push('preview: ' + e.message));
  await frame.waitForFunction(() => document.getElementById('markdown-content').children.length > 0, null, { timeout: 15000 });
  await frame.waitForFunction(() => !document.querySelector('.math-tex') || document.querySelector('mjx-container'), null, { timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: out });
  if (full) {
    const p2 = await browser.newPage({ viewport: { width: 1536, height: 864 }, deviceScaleFactor: 1.25 });
    // Same render in a full-page preview: post the editor's render into a standalone preview tab.
    const html = await page.evaluate(() => {
      const f = document.getElementById('preview').contentDocument;
      return { body: f.getElementById('markdown-content').innerHTML };
    });
    await p2.goto('http://localhost:4400/preview');
    const text = await page.evaluate(() => { const c = document.querySelector('.CodeMirror'); return c ? c.CodeMirror.getValue() : document.getElementById('source').value; });
    await p2.addScriptTag({ url: 'http://localhost:4400/vendor/markdown-it.js' });
    await p2.addScriptTag({ url: 'http://localhost:4400/vendor/markdown-it-footnote.js' });
    await p2.addScriptTag({ url: 'http://localhost:4400/vendor/markdown-it-container.js' });
    await p2.addScriptTag({ url: 'http://localhost:4400/_writer/render.js' });
    await p2.evaluate(t => { const o = SiteRender.render(t, { sourceLines: true }); window.postMessage({ type: 'render', html: o.html, meta: o.meta, words: o.words, hasMath: o.hasMath }, '*'); }, text);
    await p2.waitForTimeout(2500);
    await p2.screenshot({ path: full, fullPage: true });
  }
  console.log(errors.length ? errors.join('\n') : 'no errors');
  await browser.close();
})();
