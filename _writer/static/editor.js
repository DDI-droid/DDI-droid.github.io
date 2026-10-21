(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const frame = $('preview'), ta = $('source'), hl = $('hl');
  let slug = null, frameReady = false, dirty = false, saving = false, lastRendered = '';

  // Math and <!-- notes --> get their own colours in the source: an overlay over the Markdown mode.
  CodeMirror.defineMode('site-md', (config) => CodeMirror.overlayMode(
    CodeMirror.getMode(config, { name: 'yaml-frontmatter', base: { name: 'gfm', highlightFormatting: true, fencedCodeBlockHighlighting: false } }),
    {
      // Same rules as the renderer: $$ blocks; $x$ only with a closing $ on the line that is not
      // preceded by a space or followed by a digit, so "$5 and $10" stays plain text.
      startState: () => ({ block: false, note: false }),
      token(stream, state) {
        if (state.note) {
          if (stream.match(/^.*?-->/)) state.note = false; else stream.skipToEnd();
          return 'note';
        }
        if (stream.match('<!--')) {
          if (!stream.match(/^.*?-->/)) { state.note = true; stream.skipToEnd(); }
          return 'note';
        }
        if (state.block) {
          if (stream.match(/^.*?\$\$/)) state.block = false; else stream.skipToEnd();
          return 'math';
        }
        if (stream.sol() && stream.match(/^\s*\$\$/)) {
          if (!stream.match(/^.*?\$\$/)) { state.block = true; stream.skipToEnd(); }
          return 'math';
        }
        if (stream.peek() === '$' && stream.string[stream.pos - 1] !== '\\') {
          const s = stream.string, start = stream.pos;
          if (s[start + 1] && !/[\s$]/.test(s[start + 1])) {
            for (let p = start + 2; p < s.length; p++) {
              if (s[p] === '$' && s[p - 1] !== '\\' && !/\s/.test(s[p - 1]) && !/\d/.test(s[p + 1] || '')) {
                stream.pos = p + 1; return 'math';
              }
            }
          }
          stream.next(); return null;
        }
        while (stream.next() != null) {
          const c = stream.peek();
          if (c === '$' || (c === '<' && stream.match('<!--', false))) break;
        }
        return null;
      }
    }, true));

  // ---- the editor: a real textarea over a highlighted copy of its text ----
  // Grammarly and other writing extensions check textareas and skip editors that draw their own text, so the
  // textarea takes the typing with its text transparent, and the Markdown mode above colours an identical
  // copy underneath, one block per source line. The blocks also give each line's top for scroll sync and jumps.
  const lines = { stale: true, tops: [], starts: [] };
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  let shown = [], shownText = null;   // each line's HTML as the copy shows it now, and the text it was made from
  function highlight() {
    const html = []; let cur = '', runCls = '', runText = '';
    const width = ta.clientWidth;
    shownText = ta.value;
    // Neighbouring tokens with the same classes share one span (the note overlay arrives a character at a time).
    const flush = () => { if (runText) cur += runCls ? '<span class="' + runCls + '">' + esc(runText) + '</span>' : esc(runText); runText = ''; };
    CodeMirror.runMode(ta.value, 'site-md', (text, style) => {
      if (text === '\n') { flush(); html.push(cur || '​'); cur = ''; runCls = ''; return; }
      const cls = style ? style.split(' ').filter(s => s && !/^line-/.test(s)).map(s => 'cm-' + s).join(' ') : '';
      if (cls !== runCls) { flush(); runCls = cls; }
      runText += text;
    });
    flush();
    html.push(cur || '​');
    // Rebuilding every line costs more than tokenizing, so only the lines whose HTML changed are replaced:
    // keep the unchanged lines at both ends and swap the middle.
    const rows = hl.children;
    let a = 0, b = 0;
    while (a < html.length && a < shown.length && html[a] === shown[a]) a++;
    while (b < html.length - a && b < shown.length - a && html[html.length - 1 - b] === shown[shown.length - 1 - b]) b++;
    const oldEnd = shown.length - b, newEnd = html.length - b;
    for (let i = a; i < Math.min(oldEnd, newEnd); i++) rows[i].innerHTML = html[i];
    if (newEnd > oldEnd) {
      const frag = document.createDocumentFragment();
      for (let i = oldEnd; i < newEnd; i++) { const d = document.createElement('div'); d.innerHTML = html[i]; frag.append(d); }
      hl.insertBefore(frag, rows[oldEnd] || null);
    } else for (let i = oldEnd - 1; i >= newEnd; i--) rows[i].remove();
    shown = html;
    hl.style.width = width + 'px'; hl.scrollTop = ta.scrollTop; lines.stale = true;
  }
  // The copy must wrap at the textarea's own width, which shrinks when its scrollbar appears.
  function fit() { hl.style.width = ta.clientWidth + 'px'; hl.scrollTop = ta.scrollTop; lines.stale = true; }
  new ResizeObserver(fit).observe(ta);
  function measure() {
    if (!lines.stale) return lines;
    lines.tops = [...hl.children].map(d => d.offsetTop);
    let p = 0; lines.starts = ta.value.split('\n').map(l => { const s = p; p += l.length + 1; return s; });
    lines.stale = false; return lines;
  }
  function topLine() {
    const t = measure().tops, y = ta.scrollTop + 30;
    let lo = 0, hi = t.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (t[m] <= y) lo = m; else hi = m - 1; }
    return lo;
  }
  // Put the cursor at the start of a line; with scroll, bring the line into view a little below the top.
  function goLine(line, scroll) {
    const L = measure(); line = Math.max(0, Math.min(line, L.starts.length - 1));
    ta.setSelectionRange(L.starts[line], L.starts[line]); ta.focus({ preventScroll: true });
    ta.scrollTop = scroll ? Math.max(0, L.tops[line] - 120) : 0;
  }
  function currentLineText() {
    const v = ta.value, s = ta.selectionStart, e = v.indexOf('\n', s);
    return v.slice(v.lastIndexOf('\n', s - 1) + 1, e < 0 ? v.length : e);
  }
  // Insert at the selection through the browser's own editing, so Ctrl+Z undoes it.
  function insert(text) {
    ta.focus();
    const ok = text ? document.execCommand('insertText', false, text) : document.execCommand('delete');
    if (!ok) { ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); }
  }

  function wrap(mark) {
    const s = ta.selectionStart, sel = ta.value.slice(s, ta.selectionEnd);
    insert(mark + sel + mark);
    if (sel) ta.setSelectionRange(s, s + sel.length + 2 * mark.length); else ta.setSelectionRange(s + mark.length, s + mark.length);
  }
  function link() {
    const s = ta.selectionStart, sel = ta.value.slice(s, ta.selectionEnd) || 'text';
    insert('[' + sel + '](https://)');
    const end = s + sel.length + 12; ta.setSelectionRange(end - 9, end - 1);
  }
  // Enter in a list item starts the next item; Enter on an empty item ends the list.
  function continueList() {
    const s = ta.selectionStart, v = ta.value;
    if (s !== ta.selectionEnd) return false;
    const ls = v.lastIndexOf('\n', s - 1) + 1, before = v.slice(ls, s);
    const m = /^(\s*)(?:([-*+])|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?/.exec(before);
    if (!m) return false;
    const le = v.indexOf('\n', s), rest = v.slice(s, le < 0 ? v.length : le);
    if (before.length === m[0].length && !rest.trim()) { ta.setSelectionRange(ls, s); insert(''); return true; }
    insert('\n' + m[1] + (m[2] || (Number(m[3]) + 1) + m[4]) + m[5] + (m[6] ? '[ ] ' : ''));
    return true;
  }
  // Ctrl+/ turns the selection, or the current line, into a <!-- note -->, or back.
  function toggleNote() {
    const v = ta.value;
    let s = ta.selectionStart, e = ta.selectionEnd;
    if (s === e) { s = v.lastIndexOf('\n', s - 1) + 1; const le = v.indexOf('\n', e); e = le < 0 ? v.length : le; }
    const sel = v.slice(s, e), m = /^<!--\s?([\s\S]*?)\s?-->$/.exec(sel);
    ta.setSelectionRange(s, e);
    if (m) { insert(m[1]); ta.setSelectionRange(s, s + m[1].length); return; }
    const text = '<!-- ' + sel + ' -->';
    insert(text);
    if (sel) ta.setSelectionRange(s, s + text.length); else ta.setSelectionRange(s + 5, s + 5);
  }
  // Tab inserts two spaces, or indents every selected line.
  function indent() {
    const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
    if (s === e) { insert('  '); return; }
    const ls = v.lastIndexOf('\n', s - 1) + 1, block = v.slice(ls, e).replace(/^/gm, '  ');
    ta.setSelectionRange(ls, e); insert(block); ta.setSelectionRange(ls, ls + block.length);
  }
  ta.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && !e.altKey) {
      const act = { b: () => wrap('**'), i: () => wrap('*'), k: link, s: () => save(true), '/': toggleNote }[e.key.toLowerCase()];
      if (act) { e.preventDefault(); act(); }
      return;
    }
    if (e.key === 'Tab' && !mod && !e.altKey && !e.shiftKey) { e.preventDefault(); indent(); return; }
    if (e.key === 'Enter' && !mod && !e.altKey && !e.shiftKey && !e.isComposing && continueList()) e.preventDefault();
  });

  // ---- status, toast ----
  const status = t => { $('status').textContent = t; };
  let toastTimer = null;
  function toast(html, ms) {
    const el = $('toast'); el.innerHTML = html; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, ms || 4000);
  }
  const api = (url, opts) => fetch(url, opts).then(r => r.ok ? r : r.text().then(t => { throw new Error(t); }));

  // ---- rendering into the preview ----
  function renderNow(sync) {
    const text = ta.value;
    const out = SiteRender.render(text, { sourceLines: true });
    $('words').textContent = out.words + ' words';
    if (!frameReady) return;
    if (text === lastRendered && !sync) return;
    lastRendered = text;
    frame.contentWindow.postMessage({ type: 'render', html: out.html, meta: out.meta, words: out.words, hasMath: out.hasMath,
      syncLine: sync && $('sync').checked ? topLine() : null }, '*');
  }
  let renderTimer = null;
  const scheduleRender = () => { clearTimeout(renderTimer); renderTimer = setTimeout(() => renderNow(false), 150); };

  // ---- saving ----
  let saveTimer = null;
  function save(now) {
    if (!slug) return;
    clearTimeout(saveTimer);
    if (!now) { saveTimer = setTimeout(() => save(true), 700); return; }
    if (saving) { saveTimer = setTimeout(() => save(true), 300); return; }
    saving = true; const text = ta.value;
    status('Saving');
    api('/api/drafts/' + slug, { method: 'PUT', body: text })
      .then(() => { if (ta.value === text) dirty = false; const d = new Date(); status('Saved ' + d.toTimeString().slice(0, 5)); refreshTitle(); })
      .catch(err => status('Not saved: ' + err.message))
      .finally(() => { saving = false; });
  }
  function edited() { highlight(); dirty = true; status('Editing'); scheduleRender(); save(false); }
  ta.addEventListener('input', edited);
  // Grammarly applies a fix with insertText, which fires input; when that fails it sets the value directly, with no
  // event. Catch any such change so the coloured copy, preview and autosave never fall behind the text.
  setInterval(() => { if (shownText !== null && ta.value !== shownText) edited(); }, 250);
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ---- scroll sync, both ways ----
  let scrollRaf = 0;
  ta.addEventListener('scroll', () => {
    hl.scrollTop = ta.scrollTop;
    if (!$('sync').checked || !frameReady) return;
    cancelAnimationFrame(scrollRaf);
    scrollRaf = requestAnimationFrame(() => frame.contentWindow.postMessage({ type: 'scroll', line: topLine() }, '*'));
  });
  window.addEventListener('message', e => {
    const msg = e.data || {};
    if (msg.type === 'ready') { frameReady = true; lastRendered = ''; renderNow(true); }
    if (msg.type === 'jump') goLine(msg.line, true);
  });

  // ---- drafts ----
  function loadList(select) {
    return api('/api/drafts').then(r => r.json()).then(list => {
      const sel = $('drafts'); sel.innerHTML = '';
      for (const d of list) { const o = document.createElement('option'); o.value = d.slug; o.textContent = d.title; sel.append(o); }
      if (select) sel.value = select;
      return list;
    });
  }
  function refreshTitle() {
    const o = [...$('drafts').options].find(x => x.value === slug);
    const t = SiteRender.splitFrontMatter(ta.value).meta.title;
    if (o && t && o.textContent !== t) o.textContent = t;
  }
  function open(s) {
    if (dirty) save(true);
    return api('/api/drafts/' + s).then(r => r.text()).then(text => {
      slug = s; location.hash = s;
      ta.value = text; highlight(); dirty = false;
      $('drafts').value = s; status('Opened'); lastRendered = ''; renderNow(true);
      const line = text.indexOf('\n---', 4) >= 0 ? text.slice(0, text.indexOf('\n---', 4)).split('\n').length + 1 : 0;
      goLine(line, false);
    });
  }
  $('drafts').addEventListener('change', e => open(e.target.value));
  $('new').addEventListener('click', () => {
    const title = window.prompt('Title of the new post', '');
    if (title === null) return;
    api('/api/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title || 'Untitled' }) })
      .then(r => r.json()).then(({ slug: s }) => loadList(s).then(() => open(s)));
  });

  // ---- publishing ----
  $('publish').addEventListener('click', () => {
    if (!slug) return;
    save(true);
    setTimeout(() => api('/api/publish/' + slug, { method: 'POST' }).then(r => r.json()).then(res => {
      toast('Written to <code>' + res.file + '</code>. Live at <code>' + res.url + '</code> after a push.', 7000);
    }).catch(err => toast('Publish failed: ' + err.message, 7000)), 300);
  });

  // ---- images: paste or drop to upload ----
  function upload(file) {
    if (!slug) return;
    status('Uploading ' + file.name);
    const name = file.name && file.name !== 'image.png' ? file.name : 'image-' + Date.now() + '.' + (file.type.split('/')[1] || 'png');
    api('/api/upload?slug=' + slug + '&name=' + encodeURIComponent(name), { method: 'POST', body: file })
      .then(r => r.json()).then(({ url }) => {
        const alt = name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
        insert((currentLineText().trim() ? '\n\n' : '') + '![' + alt + '](' + url + ' "")\n\n');
        status('Uploaded');
      }).catch(err => status('Upload failed: ' + err.message));
  }
  ta.addEventListener('paste', e => {
    const files = [...(e.clipboardData && e.clipboardData.files || [])].filter(f => /^image\//.test(f.type));
    if (files.length) { e.preventDefault(); files.forEach(upload); }
  });
  ta.addEventListener('drop', e => {
    const files = [...(e.dataTransfer && e.dataTransfer.files || [])].filter(f => /^(image|video)\//.test(f.type));
    if (files.length) { e.preventDefault(); files.forEach(upload); }
  });

  // ---- layout: draggable divider, syntax sheet ----
  const split = $('split'), left = document.querySelector('.left'), divider = $('divider');
  try { const w = localStorage.getItem('writer.left'); if (w) left.style.flexBasis = w; } catch (e) {}
  divider.addEventListener('mousedown', e => {
    e.preventDefault(); split.classList.add('dragging'); divider.classList.add('drag');
    const move = ev => {
      const pct = Math.min(75, Math.max(20, (ev.clientX - split.getBoundingClientRect().left) / split.clientWidth * 100));
      left.style.flexBasis = pct + '%';
    };
    const up = () => {
      split.classList.remove('dragging'); divider.classList.remove('drag');
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
      try { localStorage.setItem('writer.left', left.style.flexBasis); } catch (e) {}
    };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  });
  // Desktop width: lesswrong.com shows sidenotes only at 1280 px and wider, so the preview can be laid out at
  // 1300 px and scaled down to fit the pane.
  const DESKTOP = 1300, pane = document.querySelector('.right'), wide = $('wide');
  try { if (localStorage.getItem('writer.wide') === '0') wide.checked = false; } catch (e) {}
  function sizeFrame() {
    const w = pane.clientWidth, h = pane.clientHeight;
    if (wide.checked && w < DESKTOP) {
      const k = w / DESKTOP;
      Object.assign(frame.style, { width: DESKTOP + 'px', height: h / k + 'px', transform: 'scale(' + k + ')', transformOrigin: '0 0' });
    } else Object.assign(frame.style, { width: '', height: '', transform: '', transformOrigin: '' });
  }
  new ResizeObserver(sizeFrame).observe(pane);
  wide.addEventListener('change', () => { try { localStorage.setItem('writer.wide', wide.checked ? '1' : '0'); } catch (e) {} sizeFrame(); });
  $('help').addEventListener('click', () => { $('sheet').hidden = !$('sheet').hidden; });
  $('sheet-close').addEventListener('click', () => { $('sheet').hidden = true; });

  // ---- start ----
  loadList().then(list => {
    const want = decodeURIComponent(location.hash.slice(1));
    if (want && list.some(d => d.slug === want)) return open(want);
    if (list.length) return open(list[0].slug);
    return api('/api/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Untitled' }) })
      .then(r => r.json()).then(({ slug: s }) => loadList(s).then(() => open(s)));
  }).catch(err => status('Could not load drafts: ' + err.message));
})();
