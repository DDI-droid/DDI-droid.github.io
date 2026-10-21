/* Runs inside the preview frame (the site's real post page with the article emptied).
   The editor posts each render here; this swaps it in, typesets math, starts stepped figures,
   rebuilds the contents rail, and keeps the scroll position in step with the editor. */
(function () {
  const article = document.getElementById('markdown-content');
  const rows = document.getElementById('toc-rows');
  const toc = document.getElementById('fixed-toc');
  const bar = document.getElementById('toc-progress');
  let entries = [], headings = [];

  // ---- contents rail, as in _layouts/post.liquid, but rebuildable ----
  const tops = () => headings.map(h => h.getBoundingClientRect().top + window.scrollY);
  const docEnd = () => article.getBoundingClientRect().bottom + window.scrollY;
  function buildToc() {
    rows.innerHTML = '';
    headings = [...article.querySelectorAll('h2, h3, h4')];
    toc.hidden = !headings.length;
    entries = headings.map((h, i) => {
      if (!h.id) h.id = 'section-' + i;
      const level = Number(h.tagName[1]) - 1;
      const wrap = document.createElement('div');
      wrap.className = 'FixedPositionToC-rowWrapper';
      wrap.innerHTML = '<div class="FixedPositionToC-rowDotContainer"><div class="FixedPositionToC-rowDot">•</div>' +
        '<div class="FixedPositionToC-rowOpacity"><div class="TableOfContentsRow-root TableOfContentsRow-level' + level + '">' +
        '<a class="TableOfContentsRow-link TableOfContentsRow-highlightDot"></a></div></div></div>';
      const link = wrap.querySelector('a');
      link.href = '#' + h.id;
      link.textContent = h.textContent.trim();
      rows.append(wrap);
      return { wrap, row: wrap.querySelector('.TableOfContentsRow-root') };
    });
    refresh();
  }
  function sizeRows() {
    const t = tops(), end = docEnd();
    entries.forEach((e, i) => { e.wrap.style.flex = Math.max(1, (i + 1 < t.length ? t[i + 1] : end) - t[i]) + ' 1 0px'; });
  }
  function track() {
    if (!entries.length) return;
    const t = tops(), y = window.scrollY, mark = y + window.innerHeight * 0.3;
    let current = -1;
    t.forEach((top, i) => { if (top <= mark) current = i; });
    entries.forEach((e, i) => e.row.classList.toggle('TableOfContentsRow-highlighted', i === current));
    const first = t[0] || 0, span = Math.max(1, docEnd() - first), h = rows.getBoundingClientRect().height;
    const top = Math.max(0, Math.min(h, (y - first) / span * h));
    bar.style.setProperty('--windowTop', top + 'px');
    bar.style.setProperty('--windowHeight', Math.max(0, Math.min(h - top, window.innerHeight / span * h)) + 'px');
  }
  function refresh() { sizeRows(); track(); }
  toc.addEventListener('mouseenter', () => toc.classList.add('FixedPositionToC-hover'));
  toc.addEventListener('mouseleave', () => toc.classList.remove('FixedPositionToC-hover'));
  window.addEventListener('scroll', track, { passive: true });
  window.addEventListener('resize', refresh);

  // ---- header fields ----
  const ordinal = d => d + (d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  function setHeader(meta, words) {
    const title = meta.title || 'Untitled';
    const parts = title.split(' '), last = parts.pop();
    const link = document.querySelector('.PostsPageTitle-link');
    if (link) link.innerHTML = (parts.length ? esc(parts.join(' ')) + ' ' : '') + '<span class="PostsPageTitle-lastWord">' + esc(last) + '</span>';
    const tocTitle = document.querySelector('.FixedPositionToC-tocTitle');
    if (tocTitle) tocTitle.textContent = title;
    document.title = title + ' | Anshul Thakur';
    const read = Math.floor(words / 220) + 1 + ' min read';
    document.querySelectorAll('.ReadTime-root').forEach(el => { el.textContent = read; });
    const time = document.querySelector('.PostsPageDate-date time');
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(meta.date || '');
    if (time && m) time.textContent = ordinal(Number(m[3])) + ' ' + months[Number(m[2]) - 1] + ' ' + m[1];
    const tags = document.querySelector('.FooterTagList-root');
    if (tags) {
      const list = [].concat(meta.tags || []).join(' ').split(/\s+/).filter(Boolean);
      const cats = [].concat(meta.categories || []).join(' ').split(/\s+/).filter(Boolean);
      tags.innerHTML = list.concat(cats).map(t => '<a class="FooterTag-root FooterTag-core" href="#">' + esc(t) + '</a>').join('') +
        (m ? '<a class="FooterTag-root FooterTag-core" href="#">' + m[1] + '</a>' : '');
    }
  }

  // ---- math ----
  let mathRun = Promise.resolve();
  function typeset() {
    if (!window.MathJax || !MathJax.startup) return Promise.resolve();
    mathRun = mathRun.then(() => MathJax.startup.promise)
      .then(() => { MathJax.typesetClear([article]); return MathJax.typesetPromise([article]); })
      .catch(err => console.warn('MathJax', err));
    return mathRun;
  }

  // ---- scroll sync ----
  function lineTop(line) {
    const els = [...article.querySelectorAll('[data-line]')];
    if (!els.length) return 0;
    let before = null, after = null;
    for (const el of els) {
      const l = Number(el.getAttribute('data-line'));
      if (l <= line) before = { el, l }; else { after = { el, l }; break; }
    }
    const y = el => el.getBoundingClientRect().top + window.scrollY;
    if (!before) return 0; // above the first block (front matter): show the title
    if (!after) return y(before.el);
    const f = (line - before.l) / Math.max(1, after.l - before.l);
    return y(before.el) + f * (y(after.el) - y(before.el));
  }

  window.addEventListener('message', e => {
    const msg = e.data || {};
    if (msg.type === 'render') {
      const y = window.scrollY;
      article.innerHTML = msg.html;
      setHeader(msg.meta || {}, msg.words || 0);
      if (window.initBuilds) window.initBuilds(article);
      if (window.LWFootnotes) window.LWFootnotes.mount(article);
      buildToc();
      window.scrollTo(0, y);
      (msg.hasMath ? typeset() : Promise.resolve()).then(() => {
        refresh();
        if (msg.syncLine != null) window.scrollTo(0, Math.max(0, lineTop(msg.syncLine) - 90));
      });
    } else if (msg.type === 'scroll') {
      window.scrollTo(0, Math.max(0, lineTop(msg.line) - 90));
    }
  });

  // Double-click a block in the preview to jump the editor to its source line.
  article.addEventListener('dblclick', e => {
    const el = e.target.closest('[data-line]');
    if (el) parent.postMessage({ type: 'jump', line: Number(el.getAttribute('data-line')) }, '*');
  });

  parent.postMessage({ type: 'ready' }, '*');
})();
