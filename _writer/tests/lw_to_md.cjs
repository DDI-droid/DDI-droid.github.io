// Convert a LessWrong post's HTML into the writer's Markdown dialect, the way a person would type it.
// Used by the recreation test: LessWrong HTML -> Markdown -> our renderer -> compare with the original.
const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');
const { JSDOM } = require('jsdom');

function texOf(el) {
  const m = el.querySelector('.mjx-math[aria-label]');
  return m ? m.getAttribute('aria-label') : (el.textContent || '').trim();
}

// Normalise LessWrong's editor quirks in the DOM before converting.
function prepare(html) {
  const doc = new JSDOM('<div id="root">' + html.replace(/&nbsp;| /g, ' ') + '</div>').window.document;
  const root = doc.getElementById('root');
  root.querySelectorAll('style').forEach(s => s.remove());
  // CKEditor writes a nested list as a sibling <li class="nested-list-item"> holding only the list.
  root.querySelectorAll('li.nested-list-item').forEach(li => {
    const prev = li.previousElementSibling;
    if (prev && prev.tagName === 'LI') { while (li.firstChild) prev.appendChild(li.firstChild); li.remove(); }
  });
  // Math: replace the rendered MathJax with markers carrying the TeX.
  root.querySelectorAll('.mjpage').forEach(mj => {
    const block = mj.classList.contains('mjpage__block');
    const holder = mj.parentElement && mj.parentElement.tagName === 'SPAN' && mj.parentElement.children.length === 1 ? mj.parentElement : mj;
    const target = holder.parentElement && holder.parentElement.classList && holder.parentElement.classList.contains('math-tex') ? holder.parentElement : holder;
    const marker = doc.createElement(block ? 'mathblock' : 'mathinline');
    marker.setAttribute('data-tex', texOf(mj));
    marker.textContent = texOf(mj) || ' '; // non-empty, or turndown drops it as blank
    target.parentNode.replaceChild(marker, target);
  });
  root.querySelectorAll('span.math-tex').forEach(m => {
    const marker = doc.createElement('mathinline');
    marker.setAttribute('data-tex', m.textContent.replace(/^\\\(|\\\)$/g, '').trim());
    marker.textContent = marker.getAttribute('data-tex') || ' ';
    m.parentNode.replaceChild(marker, m);
  });
  return root;
}

function convert(html) {
  const td = new TurndownService({ headingStyle: 'atx', hr: '---', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*', strongDelimiter: '**' });
  td.use(gfm);
  // Text escaping: also escape $ so prose dollars never read as math, and < so text like
  // '<token string>' is not read as an HTML tag.
  const baseEscape = td.escape.bind(td);
  td.escape = s => baseEscape(s).replace(/\$/g, '\\$').replace(/</g, '&lt;');

  // LessWrong section headings are h1; on the site, sections are ##.
  td.addRule('headings', {
    filter: ['h1', 'h2', 'h3', 'h4'],
    replacement: (content, node) => '\n\n' + '#'.repeat(Number(node.nodeName[1]) + 1) + ' ' + content.trim() + '\n\n'
  });
  td.addRule('mathinline', { filter: n => n.nodeName === 'MATHINLINE', replacement: (c, n) => '$' + n.getAttribute('data-tex') + '$' });
  td.addRule('mathblock', { filter: n => n.nodeName === 'MATHBLOCK', replacement: (c, n) => '\n\n$$\n' + n.getAttribute('data-tex') + '\n$$\n\n' });
  td.addRule('fnref', {
    filter: n => (n.nodeName === 'SPAN' && n.classList.contains('footnote-reference')) || (n.nodeName === 'SUP' && n.classList.contains('footnote-ref')),
    replacement: (c, n) => '[^' + (n.getAttribute('data-footnote-index') || n.textContent.replace(/\D/g, '')) + ']'
  });
  td.addRule('fnsection', {
    filter: n => n.nodeName === 'OL' && (n.classList.contains('footnote-section') || n.classList.contains('footnotes') || n.classList.contains('footnotes-list')),
    replacement: (c, n) => {
      const items = [...n.querySelectorAll(':scope > li')];
      return '\n\n' + items.map((li, i) => {
        const idx = li.getAttribute('data-footnote-index') || String(i + 1);
        const body = li.querySelector('.footnote-content') || li;
        body.querySelectorAll('.footnote-back-link, .footnote-backref').forEach(b => b.remove());
        const md = td.turndown(body.innerHTML).trim().split('\n').map((l, j) => j === 0 || !l ? l : '    ' + l).join('\n');
        return '[^' + idx + ']: ' + md;
      }).join('\n\n') + '\n\n';
    }
  });
  td.addRule('figureImage', {
    filter: n => n.nodeName === 'FIGURE' && n.classList.contains('image'),
    replacement: (c, n) => {
      const img = n.querySelector('img');
      if (!img) return c;
      const cap = n.querySelector('figcaption');
      const caption = cap ? td.turndown(cap.innerHTML).replace(/\n+/g, ' ').replace(/"/g, '\\"').trim() : '';
      const w = /width:\s*([\d.]+)%/.exec(n.getAttribute('style') || '');
      const alt = (img.getAttribute('alt') || '').replace(/[\[\]\n]/g, ' ').trim();
      return '\n\n![' + alt + '](' + img.getAttribute('src') + (caption ? ' "' + caption + '"' : '') + ')' +
        (w ? '{width=' + Math.round(Number(w[1])) + '%}' : '') + '\n\n';
    }
  });
  // Tables: GitHub-style when they are plain (an empty header row when the table has none);
  // HTML when they carry styles, row headers or several blocks in a cell. Math and footnote
  // references inside an HTML table stay as $..$ and [^n], which the renderer parses there too.
  const cellMd = cell => td.turndown(cell.innerHTML).trim().replace(/\n{2,}/g, '<br><br>').replace(/\n/g, ' ').replace(/\|/g, '\|');
  td.addRule('figureTable', {
    filter: n => n.nodeName === 'TABLE' || (n.nodeName === 'FIGURE' && n.classList.contains('table')),
    replacement: (c, n) => {
      const table = n.nodeName === 'TABLE' ? n : n.querySelector('table');
      if (!table) return c;
      const rows = [...table.rows];
      const headerRow = rows[0] && (rows[0].parentElement.nodeName === 'THEAD' || [...rows[0].cells].every(x => x.nodeName === 'TH')) ? rows[0] : null;
      const body = headerRow ? rows.slice(1) : rows;
      const styled = !!table.querySelector('[style]') || table.hasAttribute('style');
      const rowHeaders = body.some(r => [...r.cells].some(x => x.nodeName === 'TH'));
      const merged = rows.some(r => [...r.cells].some(x => x.colSpan > 1 || x.rowSpan > 1));
      const blocky = rows.some(r => [...r.cells].some(x => x.querySelectorAll('p, ul, ol, pre, blockquote').length > 1 || x.querySelector('ul, ol, pre')));
      const width = Math.max(...rows.map(r => r.cells.length));
      if (!styled && !rowHeaders && !merged && !blocky && rows.every(r => r.cells.length === width)) {
        const line = cells => '| ' + cells.join(' | ') + ' |';
        const head = headerRow ? [...headerRow.cells].map(cellMd) : Array(width).fill(' ');
        return '\n\n' + [line(head), line(Array(width).fill('---')), ...body.map(r => line([...r.cells].map(cellMd)))].join('\n') + '\n\n';
      }
      // HTML table: escape Markdown in its text, then put math and footnote references back as source.
      const clone = table.cloneNode(true);
      const doc = clone.ownerDocument, walker = doc.createTreeWalker(clone, 4);
      const texts = []; for (let t; (t = walker.nextNode());) texts.push(t);
      texts.forEach(t => { t.textContent = t.textContent.replace(/([\*_\[\]$`~])/g, '\$1'); });
      clone.querySelectorAll('mathinline').forEach(m => m.replaceWith(doc.createTextNode('$' + m.getAttribute('data-tex') + '$')));
      clone.querySelectorAll('span.footnote-reference, sup.footnote-ref').forEach(r =>
        r.replaceWith(doc.createTextNode('[^' + (r.getAttribute('data-footnote-index') || r.textContent.replace(/\D/g, '')) + ']')));
      return '\n\n<figure class="table">' + clone.outerHTML.replace(/\n/g, ' ') + '</figure>\n\n';
    }
  });
  td.addRule('details', {
    filter: n => n.nodeName === 'DETAILS',
    replacement: (c, n) => {
      const t = n.querySelector('summary');
      const title = t ? td.turndown(t.innerHTML).replace(/\n+/g, ' ').trim() : 'Details';
      const body = n.querySelector('.detailsBlockContent') || n;
      return '\n\n+++ ' + title + '\n' + td.turndown(body.innerHTML).trim() + '\n+++\n\n';
    }
  });
  td.addRule('spoilers', {
    filter: n => n.nodeName === 'DIV' && n.classList.contains('spoilers'),
    replacement: (c, n) => '\n\n' + td.turndown(n.innerHTML).trim().split('\n').map(l => l ? '>! ' + l : '>!').join('\n') + '\n\n'
  });
  td.addRule('media', {
    filter: n => n.nodeName === 'FIGURE' && n.classList.contains('media'),
    replacement: (c, n) => {
      const d = n.querySelector('[data-oembed-url]');
      const url = d && d.getAttribute('data-oembed-url');
      if (url && /youtu/.test(url)) return '\n\n' + url + '\n\n';
      return '\n\n' + n.outerHTML.replace(/\n/g, ' ') + '\n\n';
    }
  });
  td.addRule('underline', { filter: ['u'], replacement: c => '<u>' + c + '</u>' });
  // Emphasis on nothing but punctuation or spaces (an italic full stop) looks the same unstyled.
  td.addRule('emptyEmphasis', {
    filter: n => ['EM', 'I', 'STRONG', 'B'].includes(n.nodeName) && !/[\p{L}\p{N}]/u.test(n.textContent),
    replacement: c => c
  });
  td.keep(['sub', 'sup']);

  return td.turndown(prepare(html)).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

module.exports = { convert };
if (require.main === module) {
  const fs = require('fs');
  process.stdout.write(convert(fs.readFileSync(process.argv[2], 'utf8')));
}
