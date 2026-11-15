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
  // Rows are sized by section length but never shorter than their text (as on lesswrong.com); when they are
  // taller than the window the rail scrolls and follows the current section.
  const scroller = toc.closest('.MultiToCLayout-stickyBlockScroller');
  let shown = -1;
  function follow(current) {
    if (current < 0 || current === shown || !scroller || scroller.scrollHeight <= scroller.clientHeight + 1) return;
    shown = current;
    const r = entries[current].wrap.getBoundingClientRect(), s = scroller.getBoundingClientRect();
    if (r.top < s.top + 40 || r.bottom > s.bottom - 40) scroller.scrollTop += r.top - s.top - scroller.clientHeight * 0.3;
  }
  const tops = () => headings.map(h => h.getBoundingClientRect().top + window.scrollY);
  const docEnd = () => article.getBoundingClientRect().bottom + window.scrollY;
  function buildToc() {
    rows.innerHTML = ''; shown = -1;
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
    follow(current);
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
    if (time) {
      time.textContent = m ? ordinal(Number(m[3])) + ' ' + months[Number(m[2]) - 1] + ' ' + m[1] : '';
      if (m) time.setAttribute('datetime', m[0]); else time.removeAttribute('datetime');
    }
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
    mathRun = mathRun.then(async () => {
      // The bridge can run before the deferred MathJax bundle. Wait for deferred scripts
      // rather than treating the initial configuration object as a loaded math engine.
      if (document.readyState === 'loading') {
        await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
      }
      if (!window.MathJax?.typesetPromise) return;
      await MathJax.startup.promise;
      MathJax.typesetClear([article]);
      return MathJax.typesetPromise([article]);
    })
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

  const embedded = window.parent !== window;
  const snapshotKey = 'writer.previewUpdate.' + (embedded ? 'embedded' : 'standalone');
  let latestRender = null, reloadTimer = null, keepRender = true, restoredY = null;
  function reloadPreview(preserveRender) {
    keepRender = keepRender && preserveRender;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      if (!navigator.onLine) {
        window.addEventListener('online', () => reloadPreview(keepRender), { once: true });
        return;
      }
      try {
        sessionStorage.setItem(snapshotKey, JSON.stringify({ render: keepRender ? latestRender : null, y: window.scrollY }));
      } catch (err) {
        // Do not throw away an unsaved standalone preview if storage is unavailable.
        console.error('[writer] preview reload paused; could not preserve state:', err);
        return;
      }
      // Recreate the document, not individual media elements. Normal browser loading
      // revalidates every no-store local dependency, regardless of its file type.
      location.reload();
    }, 120);
  }
  function receive(msg) {
    if (msg.type === 'render') {
      latestRender = msg;
      const y = restoredY ?? window.scrollY;
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
  }
  try {
    const saved = JSON.parse(sessionStorage.getItem(snapshotKey));
    sessionStorage.removeItem(snapshotKey);
    if (saved) {
      restoredY = saved.y;
      if (saved.render) receive(saved.render);
      window.addEventListener('load', () => {
        if (restoredY != null) window.scrollTo(0, restoredY);
        restoredY = null;
      }, { once: true });
    }
  } catch (err) { console.warn('[writer] preview state restore failed:', err.message); }
  window.addEventListener('message', e => {
    if (e.origin !== location.origin || (e.source !== parent && e.source !== window)) return;
    if (e.data?.type === 'request-ready') {
      parent.postMessage({ type: 'ready' }, location.origin);
    } else receive(e.data || {});
  });

  // A preview tab is a real draft URL, not an empty shell dependent on its opener.
  // It works after F5 and without the editor, while the channel streams unsaved edits.
  if (!embedded) {
    const params = new URLSearchParams(location.search);
    let slug = params.get('slug');
    if (!slug) {
      try { slug = localStorage.getItem('writer.activeDraft'); } catch (_) {}
      if (slug) { params.set('slug', slug); history.replaceState(null, '', '/preview?' + params); }
    }
    if (slug) {
      const channel = new BroadcastChannel('writer-preview');
      let receivedLive = latestRender?.slug === slug;
      channel.onmessage = e => {
        if (e.data?.type === 'render' && e.data.slug === slug) {
          receivedLive = true;
          receive(e.data);
        }
      };
      fetch('/api/preview/' + encodeURIComponent(slug))
        .then(r => { if (!r.ok) throw new Error('Draft not found'); return r.json(); })
        .then(out => { if (!receivedLive) receive({ ...out, type: 'render' }); })
        .catch(err => { if (!receivedLive) { article.textContent = err.message; setHeader({ title: 'Preview unavailable' }, 0); } });
      channel.postMessage({ type: 'request-render', slug });

    } else {
      article.textContent = 'Choose a draft in the writer, then click Preview tab.';
      setHeader({ title: 'Choose a draft' }, 0);
    }
  }

  // Embedded and standalone previews use the same revision stream independently
  // of the editor, so a closed opener or a missed broadcast cannot strand a tab.
  WriterLiveReload.connect({ onTools: () => reloadPreview(false), onAssets: () => reloadPreview(true) });

  // Outside links open in a new tab: most sites (arXiv included) refuse to load inside this frame,
  // so following them here would leave a blank preview. The published site does the same via external_links.
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || a.origin === location.origin || !/^https?:$/.test(a.protocol)) return;
    e.preventDefault();
    window.open(a.href, '_blank', 'noopener');
  });

  // Double-click a block in the preview to jump the editor to its source line.
  article.addEventListener('dblclick', e => {
    const el = e.target.closest('[data-line]');
    if (el) parent.postMessage({ type: 'jump', line: Number(el.getAttribute('data-line')) }, '*');
  });

  if (embedded) parent.postMessage({ type: 'ready' }, location.origin);
})();
