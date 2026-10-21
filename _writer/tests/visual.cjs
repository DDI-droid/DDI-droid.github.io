// Side-by-side screenshots: the live LessWrong post body vs the writer's preview of the recreated
// Markdown.  node tests/visual.cjs <selected.json> <outDir> <slug> [heightCssPx]
const fs = require('fs');
const path = require('path');
const playwright = require('../../node_modules/playwright');
(async () => {
  const [sel, outDir, slug, h] = process.argv.slice(2);
  const height = Number(h) || 2200;
  const post = JSON.parse(fs.readFileSync(sel, 'utf8'))[slug];
  const md = fs.readFileSync(path.join(__dirname, 'lw', slug + '.md'), 'utf8');
  const browser = await playwright.chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 864 }, deviceScaleFactor: 1.25,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' });

  // LessWrong
  const lw = await ctx.newPage();
  await lw.goto(post.pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await lw.waitForSelector('.PostsPage-postContent', { timeout: 60000 });
  await lw.waitForTimeout(4000);
  await lw.addStyleTag({ content: '.intercom-lightweight-app, #intercom-container, .CookieBanner-root, [class*="cookie"], .LWPopper-root { display:none !important }' });
  const lwBox = await (await lw.$('.PostsPage-postContent')).boundingBox();
  await lw.screenshot({ path: path.join(outDir, slug + '_lw.png'), fullPage: true,
    clip: { x: lwBox.x - 10, y: lwBox.y, width: lwBox.width + 20, height: Math.min(height, lwBox.height) } });

  // Ours
  const me = await ctx.newPage();
  await me.goto('http://localhost:4400/preview');
  for (const s of ['/vendor/markdown-it.js', '/vendor/markdown-it-footnote.js', '/vendor/markdown-it-container.js', '/_writer/render.js'])
    await me.addScriptTag({ url: 'http://localhost:4400' + s });
  await me.evaluate(t => { const o = SiteRender.render(t); window.postMessage({ type: 'render', html: o.html, meta: o.meta, words: o.words, hasMath: o.hasMath }, '*'); }, md);
  await me.waitForTimeout(800);
  await me.waitForFunction(() => !document.querySelector('.math-tex') || document.querySelector('mjx-container'), null, { timeout: 30000 });
  await me.waitForTimeout(2500);
  const meBox = await (await me.$('.PostsPage-postContent')).boundingBox();
  await me.screenshot({ path: path.join(outDir, slug + '_ours.png'), fullPage: true,
    clip: { x: meBox.x - 10, y: meBox.y, width: meBox.width + 20, height: Math.min(height, meBox.height) } });
  console.log(slug, 'LW body', Math.round(lwBox.width) + 'x' + Math.round(lwBox.height), 'ours', Math.round(meBox.width) + 'x' + Math.round(meBox.height));
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
