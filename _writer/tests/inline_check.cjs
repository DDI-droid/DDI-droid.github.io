// Inline formatting check: within every article, the sequence of bold, italic, links, code,
// strikethrough, underline, sub/superscripts (with their text) must match LessWrong's.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const posts = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const MAP = { B: 'strong', STRONG: 'strong', I: 'em', EM: 'em', A: 'a', CODE: 'code', S: 's', DEL: 's', U: 'u', SUB: 'sub', SUP: 'sup' };
const norm = s => s.replace(/[\u00a0\s]+/g, ' ').trim();
function marks(html) {
  const doc = new JSDOM('<div id="r">' + html + '</div>').window.document;
  const r = doc.getElementById('r');
  r.querySelectorAll('style, script, .mjpage, .math-tex, .footnote-reference, sup.footnote-ref, .footnote-back-link, .footnote-backref, pre').forEach(n => n.remove());
  const out = [];
  r.querySelectorAll('*').forEach(el => {
    const k = MAP[el.tagName];
    if (!k) return;
    const text = norm(el.textContent);
    if (!text || !/[\p{L}\p{N}]/u.test(text)) return;
    // Nested duplicates (<strong><b>x</b></strong>) count once.
    if (el.parentElement && MAP[el.parentElement.tagName] === k && norm(el.parentElement.textContent) === text) return;
    out.push(k + (k === 'a' ? '(' + (el.getAttribute('href') || '') + ')' : '') + ':' + text);
  });
  return out;
}
for (const [slug, p] of Object.entries(posts)) {
  const ours = fs.readFileSync(path.join(__dirname, 'lw', slug + '.html'), 'utf8');
  const a = marks(p.htmlBody), b = marks(ours);
  const A = new Map(), B = new Map();
  a.forEach(x => A.set(x, (A.get(x) || 0) + 1)); b.forEach(x => B.set(x, (B.get(x) || 0) + 1));
  const missing = [...A].filter(([k, v]) => (B.get(k) || 0) < v).map(([k]) => k);
  const extra = [...B].filter(([k, v]) => (A.get(k) || 0) < v).map(([k]) => k);
  console.log('\n=== ' + slug + ': ' + a.length + ' inline marks on LessWrong, ' + b.length + ' ours; missing ' + missing.length + ', extra ' + extra.length);
  missing.slice(0, 12).forEach(x => console.log('  LW only  ' + x.slice(0, 140)));
  extra.slice(0, 12).forEach(x => console.log('  ours only ' + x.slice(0, 140)));
}
