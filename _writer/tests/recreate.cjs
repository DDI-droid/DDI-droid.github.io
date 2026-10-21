// Recreation test: LessWrong post HTML -> writer Markdown -> writer HTML, compared block by block
// with LessWrong's own HTML.  node tests/recreate.cjs <selected.json> [slug ...]
// Writes tests/lw/<slug>.md (the Markdown a person would write) and prints, per post, how many
// blocks match exactly and every block that differs.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { convert } = require('./lw_to_md.cjs');
const { render } = require('../render.js');

const norm = s => s.replace(/⟨m:⟩/g, ' ').replace(/[ \s]+/g, ' ').replace(/ ([.,;:!?)])/g, '$1').trim();
const normTex = s => s.replace(/\s+/g, '').replace(/\\(?:,|;|!|:)/g, '');

// Flatten an article into leaf blocks: [context, text], with inline math, footnote references and
// images as tokens, so both HTML dialects (LessWrong's and ours) reduce to the same description.
function blocks(html, ours) {
  const doc = new JSDOM('<div id="r">' + html + '</div>').window.document;
  const root = doc.getElementById('r');
  root.querySelectorAll('style, script').forEach(n => n.remove());
  // inline tokens
  root.querySelectorAll(ours ? 'span.math-tex' : '.mjpage:not(.mjpage__block)').forEach(m => {
    const tex = ours ? m.textContent.replace(/^\\\(|\\\)$/g, '') : (m.querySelector('.mjx-math[aria-label]') || {}).getAttribute?.('aria-label') || m.textContent;
    const holder = !ours && m.parentElement && m.parentElement.tagName === 'SPAN' && m.parentElement.children.length === 1 ? m.parentElement : m;
    holder.replaceWith(doc.createTextNode(' ⟨m:' + normTex(tex) + '⟩ '));
  });
  root.querySelectorAll('span.footnote-reference, sup.footnote-ref').forEach(r => {
    const n = r.getAttribute('data-footnote-index') || r.textContent.replace(/\D/g, '');
    r.replaceWith(doc.createTextNode('⟨fn:' + n + '⟩'));
  });
  root.querySelectorAll('.footnote-back-link, .footnote-backref').forEach(b => b.remove());
  // Line breaks and block boundaries inside a leaf read as spaces in both dialects.
  root.querySelectorAll('br').forEach(b => b.replaceWith(doc.createTextNode(' ')));
  root.querySelectorAll('td p, th p, td li, th li, li p').forEach(b => { b.before(doc.createTextNode(' ')); b.after(doc.createTextNode(' ')); });
  const out = [];
  const LEAF = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'PRE', 'FIGCAPTION', 'TD', 'TH', 'SUMMARY']);
  function ctx(el) {
    const c = [];
    for (let e = el.parentElement; e && e !== root; e = e.parentElement) {
      if (e.tagName === 'BLOCKQUOTE') c.push('quote');
      else if (e.classList.contains('spoilers')) c.push('spoiler');
      else if (e.tagName === 'DETAILS') c.push('details');
      else if (e.classList.contains('footnote-item') || (e.tagName === 'LI' && e.parentElement.matches('.footnotes, .footnote-section, .footnotes-list'))) c.push('fn' + ([...e.parentElement.children].indexOf(e) + 1));
      else if (e.tagName === 'LI') c.push(e.parentElement.tagName === 'OL' && !e.closest('.footnotes,.footnote-section') ? 'ol' : 'li');
      else if (e.tagName === 'TABLE') c.push('table');
    }
    return c.reverse().join('>');
  }
  function walk(el) {
    for (const n of [...el.children]) {
      const t = n.tagName;
      if (t === 'IMG') { out.push([ctx(n), '⟨img:' + n.getAttribute('src') + '⟩']); continue; }
      if (t === 'HR') { out.push([ctx(n), '⟨hr⟩']); continue; }
      if (t === 'IFRAME') { out.push([ctx(n), '⟨iframe:' + n.getAttribute('src') + '⟩']); continue; }
      if ((ours && n.classList.contains('math-display')) || (!ours && n.classList.contains('mjpage__block'))) {
        const tex = ours ? n.textContent.replace(/^\\\[|\\\]$/g, '') : (n.querySelector('.mjx-math[aria-label]') || {}).getAttribute?.('aria-label');
        out.push([ctx(n), '⟨M:' + normTex(tex || '') + '⟩']); continue;
      }
      let tag = t;
      if (/^H\d$/.test(t) && ours) tag = 'H' + (Number(t[1]) - 1); // ## on the site = LessWrong h1
      if (LEAF.has(t)) {
        n.querySelectorAll('img').forEach(i => { out.push([ctx(n), '⟨img:' + i.getAttribute('src') + '⟩']); i.remove(); });
        const text = norm(n.textContent);
        if (text) out.push([ctx(n) + (ctx(n) ? '>' : '') + tag.toLowerCase(), text]);
        continue;
      }
      if (t === 'LI') {
        // text directly in the li (not in a nested p/list)
        const own = [...n.childNodes].filter(c => c.nodeType === 3 || !['UL', 'OL', 'P', 'DIV', 'FIGURE', 'BLOCKQUOTE', 'PRE'].includes(c.tagName));
        const text = norm(own.map(c => c.textContent).join(''));
        if (text) out.push([ctx(n) + '>' + (n.parentElement.tagName === 'OL' ? 'ol' : 'li'), text]);
        walk(n);
        continue;
      }
      walk(n);
    }
  }
  walk(root);
  return out;
}

// LCS alignment of two block lists.
function align(a, b) {
  const key = x => x[0] + '|' + x[1];
  const A = a.map(key), B = b.map(key), n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const diffs = []; let i = 0, j = 0, same = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { same++; i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) diffs.push(['LW only ', a[i++]]);
    else diffs.push(['ours only', b[j++]]);
  }
  while (i < n) diffs.push(['LW only ', a[i++]]);
  while (j < m) diffs.push(['ours only', b[j++]]);
  return { same, diffs };
}

const posts = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const only = process.argv.slice(3);
const outDir = path.join(__dirname, 'lw');
fs.mkdirSync(outDir, { recursive: true });
for (const [slug, p] of Object.entries(posts)) {
  if (only.length && !only.includes(slug)) continue;
  const md = '---\ntitle: ' + p.title.replace(/\n/g, ' ') + '\ndate: 2026-10-18\nsmartquotes: false\nsource: ' + p.pageUrl + '\n---\n\n' + convert(p.htmlBody);
  fs.writeFileSync(path.join(outDir, slug + '.md'), md);
  const ours = render(md).html;
  fs.writeFileSync(path.join(outDir, slug + '.html'), ours);
  const a = blocks(p.htmlBody, false), b = blocks(ours, true);
  const { same, diffs } = align(a, b);
  console.log('\n=== ' + slug + ': ' + same + ' of ' + a.length + ' LessWrong blocks reproduced exactly; ' + diffs.length + ' differing entries');
  for (const [side, [c, t]] of diffs.slice(0, 40)) console.log('  ' + side + ' [' + c + '] ' + t.slice(0, 150));
}
