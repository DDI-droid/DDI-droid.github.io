// Layered editor check: node tests/editor_layers.cjs <out_dir>  (server running; the drafts API is faked, no draft is touched).
// Verifies the highlighted copy lines up with the textarea character by character, plus shortcuts, lists, autosave, scroll sync, jumps.
const fs = require('node:fs');
const playwright = require('../../node_modules/playwright');
const sink = fs.readFileSync(require('node:path').join(__dirname, 'kitchen_sink.md'), 'utf8');
const wrapped = Array.from({length: 12}, (_, i) => `Paragraph ${i + 1} has **bold words that wrap** and *italic words that wrap*, \`inline code\`, $x^2 + y_i$ math, ~~struck~~ and a [link](https://example.com) so styled spans cross line breaks. `.repeat(2));
const SAMPLE = sink.replace(/\r/g, '') + '\n\n## Wrapping test\n\n- item one\n1. first\n\n' + wrapped.join('\n\n') + '\n\nThe end.\n';
(async () => {
  const browser = await playwright.chromium.launch({headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const ctx = await browser.newContext({viewport: {width: 1440, height: 860}});
  const page = await ctx.newPage();
  const out = [], puts = [];
  page.on('pageerror', e => out.push('ERR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') out.push('CONSOLE ' + m.text()); });
  await page.route(/\/api\//, route => {
    const r = route.request(), u = new URL(r.url());
    if (u.pathname === '/api/drafts' && r.method() === 'GET') return route.fulfill({json: [{slug: 't', title: 'Test post'}]});
    if (u.pathname === '/api/drafts/t' && r.method() === 'GET') return route.fulfill({body: SAMPLE, contentType: 'text/plain'});
    if (u.pathname === '/api/drafts/t' && r.method() === 'PUT') { puts.push(r.postData()); return route.fulfill({body: 'ok'}); }
    return route.fulfill({status: 500, body: 'blocked in test: ' + r.method() + ' ' + u.pathname});
  });
  await page.goto('http://127.0.0.1:4400/#t');
  const frame = await (await page.waitForSelector('#preview')).contentFrame();
  await frame.waitForFunction(() => document.getElementById('markdown-content') && document.getElementById('markdown-content').children.length > 0, null, {timeout: 15000});
  await page.waitForTimeout(800);
  const ta = page.locator('#source');
  out.push('setup: CodeMirror editors=' + await page.locator('.CodeMirror').count() + ', textarea=' + await ta.evaluate(t => t.tagName) + ', spellcheck=' + await ta.getAttribute('spellcheck') + ', mode toggle=' + await page.locator('#plain').count());
  out.push('highlight: spans=' + await page.locator('#hl span').count() + ', classes seen=' + JSON.stringify(await page.$$eval('#hl span', s => [...new Set(s.flatMap(x => x.className.split(' ')))].filter(c => /header|strong|em|math|link|comment|quote|meta/.test(c)).sort())));

  // Alignment: every character of the coloured copy must sit where the textarea draws it. A plain twin (the
  // textarea's own rendering: one weight, no spans) is compared with the coloured copy, character by character.
  const align = async () => page.evaluate(() => {
    const ta = document.getElementById('source'), hl = document.getElementById('hl');
    const twin = hl.cloneNode(false); twin.id = ''; twin.style.visibility = 'hidden';
    twin.innerHTML = ta.value.split('\n').map(l => '<div>' + (l.replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c])) || '\u200b') + '</div>').join('');
    hl.parentNode.append(twin); twin.scrollTop = hl.scrollTop = 0;
    const pos = (root) => { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), r = document.createRange(), res = []; let n;
      while ((n = w.nextNode())) for (let i = 0; i < n.length; i++) { if (n.data[i] === '\u200b') continue; r.setStart(n, i); r.setEnd(n, i + 1); const b = r.getClientRects()[0]; if (b) res.push([b.left, b.top]); } return res; };
    const a = pos(hl), b = pos(twin); let worst = 0, bad = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) { const d = Math.max(Math.abs(a[i][0] - b[i][0]), Math.abs(a[i][1] - b[i][1])); worst = Math.max(worst, d); if (d > 0.5) bad++; }
    const res = {chars: a.length, twinChars: b.length, worstPx: +worst.toFixed(2), off: bad, heights: [ta.scrollHeight, hl.scrollHeight, twin.scrollHeight], lineTops: hl.children.length === twin.children.length && [...hl.children].every((d, i) => d.offsetTop === twin.children[i].offsetTop)};
    twin.remove(); return res;
  });
  out.push('alignment: ' + JSON.stringify(await align()));
  const sel = async (a, b) => ta.evaluate((t, [a, b]) => { t.focus(); t.setSelectionRange(a, b); }, [a, b]);
  const v = () => ta.inputValue();
  let i = (await v()).indexOf('The end.');
  await sel(i, i + 3); await page.keyboard.press('Control+b');
  out.push('bold: ' + JSON.stringify((await v()).slice(i, i + 12)) + ' coloured copy updated=' + await page.evaluate(() => document.getElementById('hl').textContent.includes('**The** end.')));
  await page.keyboard.press('Control+z');
  out.push('undo: ' + JSON.stringify((await v()).slice(i, i + 8)));
  await sel(i + 4, i + 7); await page.keyboard.press('Control+k');
  out.push('link: ' + JSON.stringify((await v()).slice(i, i + 24)));
  await page.keyboard.press('Control+z');
  i = (await v()).indexOf('- item one') + 10; await sel(i, i); await page.keyboard.press('Enter'); await page.keyboard.type('item two');
  i = (await v()).indexOf('1. first') + 8; await sel(i, i); await page.keyboard.press('Enter'); await page.keyboard.type('second');
  const L = (await v()).split('\n'), k = L.indexOf('- item one');
  out.push('lists: ' + JSON.stringify(L.slice(k, k + 4)));
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  out.push('empty item ends list: ' + JSON.stringify((await v()).split('\n').slice(k + 3, k + 5)));
  await page.keyboard.type('Typing a sentence with a tpyo in it.');
  out.push('alignment after typing: ' + JSON.stringify(await align()));
  await page.waitForTimeout(1500);
  out.push('saved: puts=' + puts.length + ', last matches=' + (puts[puts.length - 1] === await v()) + ', status=' + await page.locator('#status').innerText());
  // scroll: the coloured copy follows, and the preview follows
  await ta.evaluate(t => { t.scrollTop = t.scrollHeight * 0.45; });
  await page.waitForTimeout(700);
  out.push('scroll: textarea=' + await ta.evaluate(t => t.scrollTop) + ' copy=' + await page.evaluate(() => document.getElementById('hl').scrollTop) + ' preview scrollY=' + Math.round(await frame.evaluate(() => window.scrollY)));
  await page.screenshot({path: process.argv[2] + '/writer_layered.png'});
  // ghost check: show the textarea's own text in red over the coloured copy
  await ta.evaluate(t => { t.style.color = 'rgba(255,0,0,.75)'; });
  await page.screenshot({path: process.argv[2] + '/writer_ghost.png', clip: {x: 0, y: 40, width: 640, height: 420}});
  await ta.evaluate(t => { t.style.color = ''; });
  await page.evaluate(() => window.postMessage({type: 'jump', line: 40}, '*'));
  await page.waitForTimeout(200);
  out.push('jump: cursor line=' + await ta.evaluate(t => t.value.slice(0, t.selectionStart).split('\n').length - 1) + ', copy in step=' + await page.evaluate(() => document.getElementById('hl').scrollTop === document.getElementById('source').scrollTop));
  // Grammarly's ways of applying a fix (TextareaExecCommandReplacementService): select the range, execCommand
  // insertText; if that returns false, set .value directly with no event. The copy and autosave must follow all three.
  const copyOk = () => page.evaluate(() => [...document.getElementById('hl').children].map(d => d.textContent.replace(/​/g, '')).join('\n') === document.getElementById('source').value);
  const apply = (find, repl, direct) => ta.evaluate((t, [find, repl, direct]) => {
    const s = t.value.indexOf(find); t.focus(); t.selectionStart = s; t.selectionEnd = s + find.length;
    if (direct) { t.value = t.value.slice(0, s) + repl + t.value.slice(s + find.length); return 'direct'; }
    return document.execCommand('insertText', false, repl);
  }, [find, repl, direct]);
  const putsBefore = puts.length;
  out.push('fix via insertText: returned=' + await apply('tpyo', 'typo', false) + ', copy in step=' + await copyOk());
  out.push('fix deleting text: returned=' + await apply('Typing a ', '', false) + ', copy in step=' + await copyOk());
  out.push('fix via direct value: ' + await apply('sentence with', 'sentence that has', true) + ', copy in step at once=' + await copyOk());
  await page.waitForTimeout(400);
  out.push('  after 400 ms: copy in step=' + await copyOk() + ', status=' + await page.locator('#status').innerText());
  await page.waitForTimeout(1200);
  out.push('  autosaved with all fixes=' + (puts.length > putsBefore && /typo/.test(puts[puts.length - 1]) && /sentence that has/.test(puts[puts.length - 1])));
  // speed on a long draft
  const ms =await ta.evaluate(t => { const big = t.value.repeat(12); t.value = big; const s = performance.now(); t.dispatchEvent(new Event('input')); return [big.split('\n').length, +(performance.now() - s).toFixed(1)]; });
  out.push('long draft: ' + ms[0] + ' lines re-highlighted in ' + ms[1] + ' ms');
  console.log(out.join('\n'));
  await browser.close();
})();
