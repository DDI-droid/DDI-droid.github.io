// <!-- notes --> in the writer: coloured in the editor, absent from the preview, Ctrl+/ toggles them; and the
// Desktop width preview. Uses a fake drafts API, so real drafts are never touched.
//   node tests/notes.cjs <out_dir>      (the writer must be running on :4400)
const path = require('path');
const playwright = require('../../node_modules/playwright');
const out = process.argv[2];
const DRAFT = '---\ntitle: Notes test\ndate: 2026-10-21\n---\n\n<!-- Meta: benchmark literature in past tense; the target in present tense. -->\n\n' +
  'Last week I surveyed the benchmarks.<!-- past --> The target is a maker benchmark.[^1]\n\nA plain line to comment out.\n\n[^1]: The note.\n';

(async () => {
  const browser = await playwright.chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  let saved = DRAFT;
  await ctx.route('**/api/drafts', r => r.fulfill({ json: [{ slug: 'notes-test', title: 'Notes test' }] }));
  await ctx.route('**/api/drafts/notes-test', r => {
    if (r.request().method() === 'PUT') { saved = r.request().postData(); return r.fulfill({ body: 'ok' }); }
    return r.fulfill({ body: saved, contentType: 'text/plain' });
  });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:4400/#notes-test'); await page.waitForTimeout(1500);
  const res = {};
  res.noteSpans = await page.$$eval('#hl .cm-note', s => s.map(x => x.textContent));
  const frame = page.frame({ url: /\/preview/ });
  res.previewLeaks = await frame.evaluate(() => /Meta: benchmark|<!--|past -->/.test(document.getElementById('markdown-content').innerHTML));
  res.previewText = await frame.evaluate(() => document.querySelector('#markdown-content p:nth-of-type(1)').textContent.slice(0, 80));
  // Ctrl+/ on the plain line, then again to undo it.
  await page.evaluate(() => { const ta = document.getElementById('source'); const i = ta.value.indexOf('A plain line'); ta.focus(); ta.setSelectionRange(i + 3, i + 3); });
  await page.keyboard.press('Control+/'); await page.waitForTimeout(300);
  res.afterToggle = await page.evaluate(() => document.getElementById('source').value.split('\n').find(l => l.includes('plain line')));
  await page.keyboard.press('Control+/'); await page.waitForTimeout(300);
  res.afterUntoggle = await page.evaluate(() => document.getElementById('source').value.split('\n').find(l => l.includes('plain line')));
  res.wide = await page.evaluate(() => { const f = document.getElementById('preview'); return { width: f.style.width, transform: f.style.transform }; });
  res.sidenoteInPreview = await frame.evaluate(() => {
    const s = document.querySelector('.FootnotePreview-sidenote');
    return !!s && getComputedStyle(s).display !== 'none' && innerWidth;
  });
  await page.screenshot({ path: path.join(out, 'writer_notes.png') });
  res.errors = errs;
  console.log(JSON.stringify(res, null, 1));
  await browser.close();
})();
