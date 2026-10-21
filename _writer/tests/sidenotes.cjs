// Footnotes as lesswrong.com shows them, checked in the writer's preview (the site's own post page):
// sidenotes beside their references at desktop width, the hover card at tablet width, the dialog on a phone.
//   node tests/sidenotes.cjs <out_dir> [post.md]      (the writer must be running on :4400)
const fs = require('fs'), path = require('path');
const playwright = require('../../node_modules/playwright');
const SiteRender = require('../render.js');
const out = process.argv[2], md = process.argv[3] || path.join(__dirname, 'lw', 'chinchilla-s-wild-implications.md');
const r = SiteRender.render(fs.readFileSync(md, 'utf8'));

// LW_FOOTNOTES_JS=<file> serves that file in place of the script (e.g. the deploy's minified build).
const swap = process.env.LW_FOOTNOTES_JS ? fs.readFileSync(process.env.LW_FOOTNOTES_JS, 'utf8') : null;
async function preview(ctx) {
  if (swap) await ctx.route('**/assets/js/lw-footnotes.js', route => route.fulfill({ body: swap, contentType: 'application/javascript' }));
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:4400/preview'); await page.waitForTimeout(600);
  await page.evaluate(m => window.postMessage(m, '*'), { type: 'render', html: r.html, meta: r.meta, words: r.words, hasMath: r.hasMath });
  await page.waitForTimeout(1500);
  return { page, errs };
}

(async () => {
  const browser = await playwright.chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const res = {};

  // Desktop: every footnote gets a sidenote; each sits 6 px above its anchor unless pushed down by the one above.
  let ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  let { page, errs } = await preview(ctx);
  res.desktop = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.SideItems-sideItem')];
    const sidebarTop = document.querySelector('.SideItems-sidebar').getBoundingClientRect().top;
    const refs = [...document.querySelectorAll('#markdown-content .footnote-reference')];
    let prevBottom = -Infinity, bad = 0;
    const rows = refs.map((ref, i) => {
      const anchor = ref.querySelector('sup > span > span');
      const want = anchor.getBoundingClientRect().top - sidebarTop - 6;
      const it = items[i], top = parseFloat(it.style.top);
      // where it actually renders, not just the top it was given
      const drawn = it.getBoundingClientRect().top - sidebarTop;
      const ok = Math.abs(top - Math.max(want, prevBottom)) < 1.5 && Math.abs(drawn - top) < 1.5;
      if (!ok) bad++;
      prevBottom = top + it.clientHeight;
      return { i: i + 1, want: Math.round(want), top: Math.round(top), ok };
    });
    const first = items[0].querySelector('.FootnotePreview-sidenote');
    return { refs: refs.length, items: items.length, misplaced: bad, sidenoteShown: getComputedStyle(first).display !== 'none',
      refMarkup: refs[0].innerHTML, sample: rows.slice(0, 5) };
  });
  const a = page.locator('#markdown-content .footnote-reference a').first();
  await a.scrollIntoViewIfNeeded(); await page.mouse.move(5, 5); await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'sn_desktop.png') });
  await a.hover(); await page.waitForTimeout(400);
  res.desktopHover = await page.evaluate(() => ({ anchor: document.querySelector('#markdown-content .footnote-reference a').className,
    sidenoteHover: !!document.querySelector('.FootnotePreview-sidenoteHover'), popper: !!document.querySelector('.LWPopper-default') }));
  await page.screenshot({ path: path.join(out, 'sn_desktop_hover.png') });
  res.desktopErrors = errs;
  await ctx.close();

  // Tablet: no sidenotes; hovering a reference opens the card below it.
  ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
  ({ page, errs } = await preview(ctx));
  const b = page.locator('#markdown-content .footnote-reference a').nth(1);
  await b.scrollIntoViewIfNeeded(); await b.hover(); await page.waitForTimeout(400);
  res.tablet = await page.evaluate(() => {
    const p = document.querySelector('.LWPopper-default'), a = document.querySelectorAll('#markdown-content .footnote-reference a')[1];
    const ar = a.getBoundingClientRect(), pr = p && p.getBoundingClientRect();
    return { sidenoteShown: getComputedStyle(document.querySelector('.FootnotePreview-sidenote')).display !== 'none', popper: !!p,
      placement: p && p.getAttribute('data-popper-placement'), leftAligned: p && Math.abs(pr.left - ar.left) < 1, gap: p && Math.round(pr.top - ar.bottom) };
  });
  await page.screenshot({ path: path.join(out, 'sn_tablet_hover.png') });
  res.tabletErrors = errs;
  await ctx.close();

  // Phone: tapping a reference opens the dialog under it over a backdrop; tapping elsewhere closes it.
  ctx = await browser.newContext({ ...playwright.devices['iPhone 13'] });
  ({ page, errs } = await preview(ctx));
  const c = page.locator('#markdown-content .footnote-reference a').first();
  await c.scrollIntoViewIfNeeded(); await c.tap(); await page.waitForTimeout(500);
  res.phone = await page.evaluate(() => {
    const w = document.querySelector('.FootnoteDialog-anchoredWrapper'), a = document.querySelector('#markdown-content .footnote-reference a');
    return { dialog: !!w, backdrop: !!document.querySelector('.Backdrop-root.Backdrop-visible'), gap: w && Math.round(w.getBoundingClientRect().top - a.getBoundingClientRect().bottom), hash: location.hash };
  });
  await page.screenshot({ path: path.join(out, 'sn_phone_dialog.png') });
  await page.mouse.click(10, 10); await page.waitForTimeout(400);
  res.phoneClosed = await page.evaluate(() => !document.querySelector('.FootnoteDialog-anchoredWrapper') && !document.querySelector('.Backdrop-root'));
  res.phoneErrors = errs;
  await ctx.close();
  await browser.close();
  console.log(JSON.stringify(res, null, 1));
})();
