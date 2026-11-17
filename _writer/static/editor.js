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
      startState: () => ({ block: false, note: false, fn: false }),
      blankLine(state) { /* a blank line may sit between paragraphs of one footnote */ },
      token(stream, state) {
        // A footnote definition ([^1]: ...) and its 4-space-indented paragraphs are greyed as a whole.
        if (stream.sol()) {
          if (stream.match(/^\[\^[^\]\s]+\]:/, false)) state.fn = true;
          else if (state.fn && !/^(    |\t)/.test(stream.string)) state.fn = false;
          if (state.fn) { stream.skipToEnd(); return 'footnote'; }
        }
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
  const previewChannel = new BroadcastChannel('writer-preview');
  function renderNow(sync) {
    if (!slug) return;
    const text = ta.value;
    const out = SiteRender.render(text, { sourceLines: true });
    $('words').textContent = out.words + ' words';
    const message = { type: 'render', slug, html: out.html, meta: out.meta, words: out.words, hasMath: out.hasMath,
      syncLine: sync && $('sync').checked ? topLine() : null };
    previewChannel.postMessage({ ...message, syncLine: null });
    if (!frameReady) return;
    if (text === lastRendered && !sync) return;
    lastRendered = text;
    frame.contentWindow.postMessage(message, location.origin);
  }
  let renderTimer = null;
  const scheduleRender = () => { clearTimeout(renderTimer); renderTimer = setTimeout(() => renderNow(false), 150); };

  // ---- three-way merge (line based) ----
  // base: the text this editor last loaded or saved; mine: the editor now; theirs: the file on disk now.
  // Changes from the two sides that touch different lines are combined; a clash returns { conflict: true }.
  function diffHunks(a, b) {
    const n = a.length, m = b.length;
    let pre = 0; while (pre < n && pre < m && a[pre] === b[pre]) pre++;
    let suf = 0; while (suf < n - pre && suf < m - pre && a[n - 1 - suf] === b[m - 1 - suf]) suf++;
    const A = a.slice(pre, n - suf), B = b.slice(pre, m - suf), N = A.length, M = B.length;
    const L = []; for (let i = 0; i <= N; i++) L.push(new Int32Array(M + 1));
    for (let i = N - 1; i >= 0; i--) for (let j = M - 1; j >= 0; j--)
      L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const hunks = []; let i = 0, j = 0, cur = null;
    while (i < N || j < M) {
      if (i < N && j < M && A[i] === B[j]) { if (cur) { hunks.push(cur); cur = null; } i++; j++; }
      else if (j < M && (i >= N || L[i][j + 1] >= L[i + 1][j])) { if (!cur) cur = { s: pre + i, e: pre + i, lines: [] }; cur.lines.push(B[j]); j++; }
      else { if (!cur) cur = { s: pre + i, e: pre + i, lines: [] }; cur.e = pre + i + 1; i++; }
    }
    if (cur) hunks.push(cur);
    return hunks;
  }
  function merge3(base, mine, theirs) {
    if (mine === theirs || base === theirs) return { text: mine, conflict: false };
    if (base === mine) return { text: theirs, conflict: false };
    const B = base.split('\n');
    const all = diffHunks(B, mine.split('\n')).map(h => Object.assign(h, { side: 'm' }))
      .concat(diffHunks(B, theirs.split('\n')).map(h => Object.assign(h, { side: 't' })))
      .sort((x, y) => x.s - y.s || x.e - y.e);
    const groups = [];
    for (const h of all) {
      const g = groups[groups.length - 1];
      if (g && (h.s < g.e || (h.s === g.e && g.s === g.e))) { g.hunks.push(h); g.e = Math.max(g.e, h.e); }
      else groups.push({ s: h.s, e: h.e, hunks: [h] });
    }
    const out = []; let pos = 0;
    const apply = (g, side) => {
      const seg = []; let p = g.s;
      for (const h of g.hunks) if (h.side === side) { seg.push(...B.slice(p, h.s), ...h.lines); p = h.e; }
      seg.push(...B.slice(p, g.e));
      return seg;
    };
    for (const g of groups) {
      out.push(...B.slice(pos, g.s));
      const sides = new Set(g.hunks.map(h => h.side));
      if (sides.size === 1) out.push(...apply(g, g.hunks[0].side));
      else {
        const a = apply(g, 'm'), b = apply(g, 't');
        if (a.join('\n') !== b.join('\n')) return { conflict: true };
        out.push(...a);
      }
      pos = g.e;
    }
    out.push(...B.slice(pos));
    return { text: out.join('\n'), conflict: false };
  }

  // ---- saving ----
  // baseHash is the version of the file this editor last loaded or saved. A save based on it is refused by the
  // server if the file changed on disk in between, so nothing written outside the editor is silently overwritten.
  let saveTimer = null, baseHash = null, conflictFor = null, baseText = null, merging = false;
  let lastTyped = 0, applyingIncoming = false, clashShown = null;
  const IDLE_MS = 60000;
  async function putDraft(text) {
    const r = await fetch('/api/drafts/' + slug, { method: 'PUT', body: text, headers: baseHash ? { 'x-base-hash': baseHash } : {} });
    if (r.status === 409) return { conflict: (await r.json()).hash };
    if (!r.ok) throw new Error(await r.text());
    baseHash = (await r.json()).hash;
    return { ok: true };
  }
  function save(now) {
    if (!slug) return;
    clearTimeout(saveTimer);
    if (!now) { saveTimer = setTimeout(() => save(true), 700); return; }
    if (saving) { saveTimer = setTimeout(() => save(true), 300); return; }
    saving = true; const text = ta.value;
    status('Saving');
    putDraft(text)
      .then(res => {
        if (res.conflict) { tryMerge(res.conflict); return; }
        baseText = text; clearBackup(text); if (ta.value === text) dirty = false; const d = new Date(); status('Saved ' + d.toTimeString().slice(0, 5)); refreshTitle(); refreshStatus(1200);
      })
      .catch(err => status('Not saved: ' + err.message))
      .finally(() => { saving = false; });
  }

  // ---- changes made on disk by something else ----
  // With no unsaved typing, take the disk version in place (cursor and scroll kept); otherwise ask.
  async function reloadFromDisk() {
    const r = await api('/api/drafts/' + slug), text = await r.text();
    const s = ta.selectionStart, e = ta.selectionEnd, top = ta.scrollTop;
    ta.value = text; highlight(); dirty = false; baseText = text;
    baseHash = r.headers.get('x-draft-hash'); conflictFor = null;
    ta.setSelectionRange(Math.min(s, text.length), Math.min(e, text.length));
    ta.scrollTop = top; hl.scrollTop = top;
    renderNow(false); refreshTitle(); refreshStatus(0);
    status('Updated from disk ' + new Date().toTimeString().slice(0, 5));
  }
  function showConflict(diskHash) {
    if (conflictFor === diskHash) return;
    conflictFor = diskHash;
    toast('This draft changed on disk while you were typing. <button type="button" id="cf-disk">Load the disk version</button> ' +
      '<button type="button" id="cf-mine">Keep mine</button>', 600000);
    $('cf-disk').onclick = () => { $('toast').hidden = true; reloadFromDisk().then(() => offerRestore(ta.value)).catch(err => status('Could not load: ' + err.message)); };
    $('cf-mine').onclick = () => { $('toast').hidden = true; baseHash = diskHash; conflictFor = null; save(true); };
  }
  // Typing here while something else (an agent, another tab) writes the same file: merge both instead of
  // forcing a choice. Only when both changed the same lines does the old choice appear.
  async function mergeFromDisk(diskHash) {
    if (baseText === null) { showConflict(diskHash); return false; }
    merging = true;
    try {
      const r = await api('/api/drafts/' + slug), disk = await r.text(), hash = r.headers.get('x-draft-hash');
      const mine = ta.value, m = merge3(baseText, mine, disk);
      if (m.conflict) { showConflict(hash || diskHash); return false; }
      let prefix = 0; while (prefix < mine.length && prefix < m.text.length && mine[prefix] === m.text[prefix]) prefix++;
      const shift = m.text.length - mine.length, s0 = ta.selectionStart, e0 = ta.selectionEnd, top = ta.scrollTop;
      ta.value = m.text; highlight();
      ta.setSelectionRange(s0 > prefix ? s0 + shift : s0, e0 > prefix ? e0 + shift : e0);
      ta.scrollTop = top; hl.scrollTop = top;
      baseText = disk; baseHash = hash; conflictFor = null; dirty = m.text !== disk;
      renderNow(false); refreshTitle();
      status('Merged in changes made on disk ' + new Date().toTimeString().slice(0, 5));
      return true;
    } finally { merging = false; }
  }

  // ---- never lose typing ----
  // A copy of unsaved writing is kept in this browser until the file holds it, so a reload, a refused save or
  // "Load the disk version" can always be undone: on opening the draft the writer offers to merge it back.
  const backupKey = s => 'writer.unsaved.' + s;
  function keepBackup() {
    if (!slug) return;
    try { localStorage.setItem(backupKey(slug), JSON.stringify({ text: ta.value, base: baseText, t: Date.now() })); } catch (_) {}
  }
  function clearBackup(savedText) {
    if (!slug) return;
    try { if (ta.value === savedText) localStorage.removeItem(backupKey(slug)); } catch (_) {}
  }
  function offerRestore(diskText) {
    let b = null;
    try { b = JSON.parse(localStorage.getItem(backupKey(slug)) || 'null'); } catch (_) {}
    if (!b || typeof b.text !== 'string' || b.text === diskText) { try { localStorage.removeItem(backupKey(slug)); } catch (_) {} return; }
    const when = new Date(b.t).toTimeString().slice(0, 5), key = backupKey(slug), name = slug;
    const show = canMerge => {
      toast((canMerge ? 'You have unsaved writing from ' + when + ' that is not in the file. <button type="button" id="bk-restore">Restore it</button> '
        : 'Your unsaved writing from ' + when + ' and the file changed the same lines, so it was not merged. ') +
        '<button type="button" id="bk-download">Download it</button> <button type="button" id="bk-discard">Discard</button>', 3600000);
      if (canMerge) $('bk-restore').onclick = () => {
        const m = b.base != null ? merge3(b.base, b.text, ta.value) : { conflict: true };
        if (m.conflict) return show(false);
        $('toast').hidden = true;
        ta.value = m.text; highlight(); dirty = true; renderNow(false); save(true);
        status('Restored your unsaved writing ' + new Date().toTimeString().slice(0, 5));
      };
      $('bk-download').onclick = () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([b.text], { type: 'text/markdown' }));
        a.download = name + '.unsaved-' + when.replace(':', '') + '.md'; a.click();
      };
      $('bk-discard').onclick = () => { $('toast').hidden = true; try { localStorage.removeItem(key); } catch (_) {} };
    };
    show(true);
  }

  // ---- agent edits ----
  // Agents queue their edits instead of writing the file; they are merged in after a minute without typing,
  // so they never land under the cursor. An edit that changed the same lines as the author is not applied.
  async function applyIncoming() {
    if (!slug || applyingIncoming || saving || merging) return;
    applyingIncoming = true;
    try {
      const { items } = await (await api('/api/drafts/' + slug + '/incoming')).json();
      if (!items.length) return;
      const mine = ta.value; let text = mine; const done = [];
      for (const it of items) {
        const m = merge3(it.base, text, it.text);
        if (m.conflict) { showIncomingClash(it); continue; }   // hold back only the clashing edit
        text = m.text; done.push(it.id);
      }
      if (!done.length) return;
      if (text !== mine) {
        let prefix = 0; while (prefix < mine.length && prefix < text.length && mine[prefix] === text[prefix]) prefix++;
        const shift = text.length - mine.length, s0 = ta.selectionStart, e0 = ta.selectionEnd, top = ta.scrollTop;
        ta.value = text; highlight();
        ta.setSelectionRange(s0 > prefix ? s0 + shift : s0, e0 > prefix ? e0 + shift : e0);
        ta.scrollTop = top; hl.scrollTop = top; renderNow(false);
        saving = true;
        let res; try { res = await putDraft(text); } finally { saving = false; }
        if (res.conflict) { tryMerge(res.conflict); return; }
        baseText = text; clearBackup(text); if (ta.value === text) dirty = false;
      }
      await fetch('/api/drafts/' + slug + '/incoming', { method: 'DELETE', body: JSON.stringify({ ids: done }) });
      status('Applied ' + done.length + ' agent edit' + (done.length > 1 ? 's ' : ' ') + new Date().toTimeString().slice(0, 5));
      refreshTitle();
    } catch (err) { status('Agent edits not applied: ' + err.message); }
    finally { applyingIncoming = false; }
  }
  function showIncomingClash(it) {
    if (clashShown === it.id) return;
    clashShown = it.id;
    toast('An agent edit (' + it.from + ') changed the same lines you did, so it was not applied. ' +
      '<button type="button" id="in-download">Download it</button> <button type="button" id="in-skip">Skip it</button>', 3600000);
    $('in-download').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([it.text], { type: 'text/markdown' }));
      a.download = slug + '.agent-edit.md'; a.click();
    };
    $('in-skip').onclick = () => {
      $('toast').hidden = true;
      fetch('/api/drafts/' + slug + '/incoming', { method: 'DELETE', body: JSON.stringify({ ids: [it.id] }) });
    };
  }
  function tryMerge(diskHash) {
    mergeFromDisk(diskHash).then(ok => { if (ok && dirty) save(true); }).catch(() => showConflict(diskHash));
  }
  setInterval(() => {
    if (!slug || saving || merging || liveReloading || !baseHash) return;
    fetch('/api/drafts/' + slug + '/hash').then(r => r.ok ? r.json() : null).then(j => {
      if (!j || saving) return;
      if (j.hash !== baseHash) {
        if (!dirty && shownText === ta.value) reloadFromDisk().catch(err => status('Could not load: ' + err.message));
        else tryMerge(j.hash);
        return;
      }
      if (j.incoming) {
        const wait = IDLE_MS - (Date.now() - lastTyped);
        if (wait <= 0) applyIncoming();
        else status(j.incoming + ' agent edit' + (j.incoming > 1 ? 's' : '') + ' waiting; applied after ' + Math.ceil(wait / 1000) + ' s without typing');
      }
    }).catch(() => {});
  }, 2000);
  function edited() { highlight(); dirty = true; lastTyped = Date.now(); keepBackup(); status('Editing'); scheduleRender(); if (!liveReloading) save(false); }
  ta.addEventListener('input', edited);
  // Grammarly applies a fix with insertText, which fires input; when that fails it sets the value directly, with no
  // event. Catch any such change so the coloured copy, preview and autosave never fall behind the text.
  setInterval(() => { if (shownText !== null && ta.value !== shownText) edited(); }, 250);
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ---- always-on live reload ----
  // Save the current draft before reloading so an edit to the studio itself never discards writing.
  async function flushDraftForReload() {
    clearTimeout(saveTimer);
    while (saving) await new Promise(resolve => setTimeout(resolve, 40));
    clearTimeout(saveTimer);
    // Writing extensions can change .value without input; do not wait for the polling tick.
    if (slug && shownText !== null && ta.value !== shownText) { highlight(); dirty = true; }
    if (!slug || !dirty) return true;
    const text = ta.value;
    saving = true;
    status('Saving before update');
    try {
      const res = await putDraft(text);
      if (res.conflict) {
        saving = false;
        if (!(await mergeFromDisk(res.conflict).catch(() => false))) { status('Not saved: the file changed on disk'); return false; }
        return await flushDraftForReload();
      }
      baseText = text; clearBackup(text); if (ta.value === text) dirty = false;
      status('Saved');
    } catch (err) {
      status('Not saved: ' + err.message);
      toast('Could not save the draft. The requested action was cancelled; your text is still here.', 7000);
      return false;
    } finally {
      saving = false;
    }
    return dirty ? flushDraftForReload() : true;
  }
  let liveReloading = false;
  function applyLiveUpdate() {
    if (liveReloading) return;
    liveReloading = true;
    flushDraftForReload().then(ok => {
      if (ok) {
        try { sessionStorage.setItem('writer.reloadPosition', JSON.stringify({ slug,
          start: ta.selectionStart, end: ta.selectionEnd, scroll: ta.scrollTop })); } catch (_) {}
        window.location.reload();
      }
      else liveReloading = false;
    }).catch(err => {
      liveReloading = false;
      status('Live update paused: ' + err.message);
    });
  }
  function connectLiveReload() {
    // Asset changes belong to preview documents, not the text editor. Source-code
    // changes still flush unsaved writing before a safe editor reload.
    WriterLiveReload.connect({ onTools: applyLiveUpdate });
  }

  // ---- scroll sync, both ways ----
  let scrollRaf = 0;
  ta.addEventListener('scroll', () => {
    hl.scrollTop = ta.scrollTop;
    if (!$('sync').checked || !frameReady) return;
    cancelAnimationFrame(scrollRaf);
    scrollRaf = requestAnimationFrame(() => frame.contentWindow.postMessage({ type: 'scroll', line: topLine() }, '*'));
  });
  window.addEventListener('message', e => {
    if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
    const msg = e.data || {};
    if (msg.type === 'ready') { frameReady = true; lastRendered = ''; renderNow(true); }
    if (msg.type === 'jump') goLine(msg.line, true);
  });
  // Either script may load first. Probe now and after each frame navigation instead of
  // relying on a one-shot ready message that can arrive before this script is loaded.
  const probePreview = () => frame.contentWindow.postMessage({ type: 'request-ready' }, location.origin);
  frame.addEventListener('load', () => { frameReady = false; probePreview(); });
  probePreview();
  previewChannel.onmessage = e => {
    if (e.data?.type === 'request-render' && e.data.slug === slug) renderNow(false);
  };

  // ---- drafts: every post, the ones on the site included; the list says which are not on the site yet ----
  const SUFFIX = { new: ' · not on the site', changed: ' · changed' };
  const label = (title, state) => title + (SUFFIX[state] || '');
  function loadList(select) {
    return api('/api/drafts').then(r => r.json()).then(list => {
      const sel = $('drafts'); sel.innerHTML = '';
      conflicts = list.filter(d => d.conflict);
      if (lastRemote) renderRemote(lastRemote);
      for (const d of list) {
        const o = document.createElement('option'); o.value = d.slug;
        o.dataset.title = d.title; o.dataset.state = d.state || ''; o.textContent = label(d.title, d.state);
        sel.append(o);
      }
      if (select) sel.value = select;
      return list;
    });
  }
  function refreshTitle() {
    const o = [...$('drafts').options].find(x => x.value === slug);
    const meta = SiteRender.splitFrontMatter(ta.value).meta.title;
    const t = meta && (slug.startsWith('page-') ? 'Page: ' : '') + meta;
    if (o && t && o.dataset.title !== t) { o.dataset.title = t; o.textContent = label(t, o.dataset.state); }
  }
  let opening = 0;
  async function open(s) {
    const request = ++opening;
    if (!(await flushDraftForReload())) { $('drafts').value = slug; return; }
    const response = await api('/api/drafts/' + s);
    const text = await response.text();
    if (request !== opening) return;
    {
      slug = s; location.hash = s;
      $('open').href = '/preview?slug=' + encodeURIComponent(s);
      try { localStorage.setItem('writer.activeDraft', s); } catch (_) {}
      ta.value = text; highlight(); dirty = false; baseText = text;
      baseHash = response.headers.get('x-draft-hash'); conflictFor = null;
      $('drafts').value = s; $('delete').hidden = true; status('Opened'); lastRendered = ''; renderNow(true); refreshStatus(0);
      offerRestore(text);
      const line = text.indexOf('\n---', 4) >= 0 ? text.slice(0, text.indexOf('\n---', 4)).split('\n').length + 1 : 0;
      goLine(line, false);
      try {
        const position = JSON.parse(sessionStorage.getItem('writer.reloadPosition'));
        sessionStorage.removeItem('writer.reloadPosition');
        if (position?.slug === slug) {
          ta.setSelectionRange(position.start, position.end);
          ta.scrollTop = position.scroll;
          hl.scrollTop = ta.scrollTop;
          renderNow(true);
        }
      } catch (_) {}
    }
  }
  $('drafts').addEventListener('change', e => open(e.target.value).catch(err => status('Could not open draft: ' + err.message)));
  $('new').addEventListener('click', () => {
    const title = window.prompt('Title of the new post', '');
    if (title === null) return;
    api('/api/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title || 'Untitled' }) })
      .then(r => r.json()).then(({ slug: s }) => loadList(s).then(() => open(s)));
  });
  // Delete: only for a draft the site does not have (the button shows only then). Its text stays in History.
  $('delete').addEventListener('click', async () => {
    const target = slug; if (!target) return;
    const o = [...$('drafts').options].find(x => x.value === target);
    const name = (o && o.dataset.title) || target;
    if (!window.confirm('Delete "' + name + '"? It is not on the site, so this removes it from the writer.')) return;
    if (!(await flushDraftForReload()) || slug !== target) return;
    status('Deleting');
    try { await api('/api/drafts/' + target, { method: 'DELETE' }); }
    catch (err) { toast('Could not delete: ' + esc(err.message), 8000); refreshStatus(0); return; }
    clearTimeout(saveTimer); dirty = false; slug = null; $('delete').hidden = true;
    const list = await loadList();
    if (list.length) await open(list[0].slug);
    else {
      const { slug: s } = await (await api('/api/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Untitled' }) })).json();
      await loadList(s); await open(s);
    }
    toast('Deleted "' + esc(name) + '".', 5000);
  });

  // ---- the post on the site: its state, Commit, Push, History ----
  // Commit writes the post into _posts, commits it with its images (nothing else) and pushes, so the site
  // rebuilds. The source, notes included, is kept as a version on this machine only.
  const STATE_TEXT = { new: 'Not on the site', changed: 'Changed', live: 'On the site' };
  const STATE_TIP = { new: 'Never committed: the site does not have this post yet', changed: 'Edited since the last commit',
    live: 'The site has this version' };
  const siteLink = (href, text) => '<a href="' + esc(href).replace(/"/g, '&quot;') + '" target="_blank" rel="noopener">' + esc(text) + '</a>';
  let statusTimer = null;
  function showStatus(st) {
    const el = $('state');
    el.textContent = STATE_TEXT[st.state] || ''; el.className = 'state ' + (st.state || '');
    el.title = (STATE_TIP[st.state] || '') + (st.ahead ? '. ' + st.ahead + ' commit(s) not pushed yet' : '');
    $('delete').hidden = !st.deletable;
    if (lastRemote && lastRemote.ahead !== st.ahead) renderRemote({ ...lastRemote, ahead: st.ahead });
    const o = [...$('drafts').options].find(x => x.value === st.slug);
    if (o) { o.dataset.state = st.state; o.textContent = label(o.dataset.title || st.title, st.state); }
  }
  function refreshStatus(wait) {
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      const target = slug; if (!target) return;
      fetch('/api/status/' + target).then(r => r.ok ? r.json() : null)
        .then(st => { if (st && st.slug === slug) showStatus(st); }).catch(() => {});
    }, wait || 0);
  }
  const closeSheets = () => { for (const id of ['sheet', 'commit-sheet', 'history-sheet', 'remote-sheet']) $(id).hidden = true; };

  $('commit').addEventListener('click', async () => {
    if (!slug) return;
    const target = slug;
    $('commit').disabled = true;
    try {
      if (!(await flushDraftForReload()) || slug !== target) return;
      const st = await (await api('/api/status/' + target)).json();
      if (slug !== target) return;
      showStatus(st);
      $('commit-what').textContent = st.error ? 'Cannot commit: ' + st.error
        : st.state === 'new' ? 'Adds this post to the site.'
        : st.state === 'changed' ? 'Updates this post on the site.'
        : 'The site already has this version; nothing new to commit.';
      $('commit-msg').value = (st.state === 'new' ? 'Add post: ' : 'Update post: ') + st.title;
      $('commit-files').innerHTML = st.files.map(f => '<li><code>' + esc(f.path) + '</code><span class="tag">' + esc(f.change) + '</span></li>').join('');
      $('commit-note').hidden = !st.ahead;
      $('commit-note').textContent = st.ahead ? 'Also pushes ' + st.ahead + ' earlier commit(s) that are only on this machine.' : '';
      $('commit-go').disabled = !!st.error;
      closeSheets(); $('commit-sheet').hidden = false;
      $('commit-msg').focus(); $('commit-msg').select();
    } catch (err) { toast('Could not check the post: ' + esc(err.message), 7000); }
    finally { $('commit').disabled = false; }
  });
  async function commitNow() {
    if (!slug || $('commit-go').disabled) return;
    const target = slug, go = $('commit-go');
    go.disabled = true; go.textContent = 'Committing';
    try {
      if (!(await flushDraftForReload()) || slug !== target) return;
      const res = await (await api('/api/commit/' + target, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: $('commit-msg').value }) })).json();
      $('commit-sheet').hidden = true;
      if (!res.commit && res.pushed) toast('Nothing new to commit: the site already has this version. ' + siteLink(res.site, res.url), 8000);
      else if (res.pushed) toast('Committed ' + esc(res.commit) + ' and pushed. ' + siteLink(res.site, res.url) +
        ' shows it once GitHub has rebuilt the site, in a minute or two.', 12000);
      else toast('Committed ' + esc(res.commit || '') + ' on this machine, but it was not pushed: ' + esc(res.pushError || 'unknown error') +
        '. The GitHub button shows what differs.', 20000);
    } catch (err) { toast('Commit failed: ' + esc(err.message), 12000); }
    finally { go.disabled = false; go.textContent = 'Commit and push'; refreshStatus(0); checkRemote(false); loadList(slug).catch(() => {}); }
  }
  $('commit-go').addEventListener('click', commitNow);
  $('commit-msg').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commitNow(); } });
  $('commit-cancel').addEventListener('click', () => { $('commit-sheet').hidden = true; });
  $('commit-close').addEventListener('click', () => { $('commit-sheet').hidden = true; });

  // ---- this copy and GitHub: pull before push, and show what differs ----
  // The button reads ↓n (commits on GitHub, not here), ↑n (here, not on GitHub) and "!n" (posts edited here
  // and on the site since their last version). Its sheet pulls, then pushes, and resolves those posts.
  let lastRemote = null, conflicts = [], remoteBusy = false, remoteChecked = 0;
  function renderRemote(r) {
    lastRemote = r;
    const b = $('remote'), bits = [];
    if (r.behind) bits.push('↓' + r.behind);
    if (r.ahead) bits.push('↑' + r.ahead);
    if (conflicts.length) bits.push('!' + conflicts.length);
    b.textContent = r.fetchError ? 'GitHub: offline' : bits.length ? 'GitHub ' + bits.join(' ') : 'GitHub: in sync';
    b.classList.toggle('out', !!(r.fetchError || bits.length));
    b.title = r.fetchError ? 'Could not reach GitHub: ' + r.fetchError
      : bits.length ? [r.behind && r.behind + ' commit(s) on GitHub not here', r.ahead && r.ahead + ' commit(s) here not on GitHub',
        conflicts.length && conflicts.length + ' post(s) edited here and on the site'].filter(Boolean).join('; ') + '. Click to sync.'
      : 'This copy and GitHub match';
  }
  async function checkRemote(fetchIt) {
    try {
      const r = await (await api('/api/remote' + (fetchIt ? '?fetch=1' : ''))).json();
      if (fetchIt) remoteChecked = Date.now();
      renderRemote(r);
      return r;
    } catch (err) { return null; }
  }
  function remoteSheet() {
    const r = lastRemote || {}, out = [];
    const commitList = cs => '<ul class="files">' + cs.map(c => '<li><code>' + esc(c.id) + '</code> ' + esc(c.subject) +
      '<span class="tag">' + esc(c.author + ', ' + c.date) + '</span></li>').join('') + '</ul>';
    if (r.fetchError) out.push('<p class="note">Could not reach GitHub: ' + esc(r.fetchError) + '</p>');
    if (!r.fetchError && !r.behind && !r.ahead && !conflicts.length) out.push('<p class="what">This copy and GitHub match. Nothing to pull or push.</p>');
    if (r.behind) out.push('<p class="field">On GitHub, not here</p>' + commitList(r.incoming || []));
    if (r.blocked && r.blocked.length) out.push('<p class="note">These files changed on GitHub and also have uncommitted changes here, so the pull ' +
      'will stop rather than overwrite them: ' + r.blocked.map(f => '<code>' + esc(f) + '</code>').join(', ') + '. Commit or undo them first.</p>');
    if (r.ahead) out.push('<p class="field">Here, not on GitHub</p>' + commitList(r.outgoing || []));
    if (conflicts.length) out.push('<p class="field">Edited here and on the site</p><ul class="files">' + conflicts.map(d =>
      '<li>' + esc(d.title) + ' <button type="button" data-take="' + esc(d.slug) + '">Use the site version</button> <button type="button" data-keep="' +
      esc(d.slug) + '">Keep mine</button></li>').join('') + '</ul><p class="what">Use the site version replaces your draft with the site file ' +
      '(your text stays in History). Keep mine leaves your draft; your next Commit writes it over the site version.</p>');
    $('remote-body').innerHTML = out.join('');
    const go = $('remote-go');
    go.hidden = !(r.behind || r.ahead) || !!r.fetchError;
    go.textContent = r.behind && r.ahead ? 'Pull, then push' : r.behind ? 'Pull' : 'Push';
    $('remote-body').querySelectorAll('button[data-take], button[data-keep]').forEach(b => b.addEventListener('click', () => resolve(b)));
  }
  async function openRemote() {
    closeSheets(); $('remote-sheet').hidden = false;
    $('remote-body').innerHTML = '<p class="what">Checking GitHub</p>'; $('remote-go').hidden = true;
    await checkRemote(true); await loadList(slug).catch(() => {});
    remoteSheet();
  }
  async function resolve(button) {
    const target = button.dataset.take || button.dataset.keep, take = !!button.dataset.take;
    button.disabled = true;
    try {
      if (take && target === slug && !(await flushDraftForReload())) return;
      await api('/api/drafts/' + target + (take ? '/take-site' : '/keep-mine'), { method: 'POST' });
      await loadList(slug);
      if (take && target === slug) await reloadFromDisk();
      renderRemote(lastRemote || {}); remoteSheet();
      toast(take ? 'Took the site version; your text is in History.' : 'Kept your draft; Commit will write it over the site version.', 7000);
    } catch (err) { toast('Could not resolve: ' + esc(err.message), 8000); button.disabled = false; }
  }
  $('remote').addEventListener('click', openRemote);
  $('remote-close').addEventListener('click', () => { $('remote-sheet').hidden = true; });
  $('remote-refresh').addEventListener('click', openRemote);
  $('remote-go').addEventListener('click', async () => {
    if (remoteBusy) return;
    remoteBusy = true; const go = $('remote-go'); go.disabled = true; go.textContent = 'Syncing';
    try {
      if (slug) await flushDraftForReload();
      const res = await (await api('/api/sync', { method: 'POST' })).json();
      await loadList(slug).catch(() => {});
      renderRemote(res);
      const done = [res.brought && 'pulled ' + res.brought + ' commit(s)', res.sent && 'pushed ' + res.sent].filter(Boolean).join(', then ');
      if (res.pushed) toast('In sync with GitHub' + (done ? ': ' + done + '.' : '.') + (res.sent ? ' The site rebuilds in a minute or two.' : ''), 9000);
      else toast('Not synced: ' + esc(res.pushError || res.pullError || 'unknown error'), 20000);
      remoteSheet();
    } catch (err) { toast('Sync failed: ' + esc(err.message), 15000); }
    finally { remoteBusy = false; go.disabled = false; refreshStatus(0); }
  });
  // Check GitHub on start, every five minutes, and when the tab comes back after a while.
  setInterval(() => { if (!remoteBusy) checkRemote(true); }, 5 * 60 * 1000);
  window.addEventListener('focus', () => { if (!remoteBusy && Date.now() - remoteChecked > 60 * 1000) checkRemote(true); });

  // History: restoring keeps the current text as a version first, so nothing is lost by trying an old one.
  let armed = null;
  $('history').addEventListener('click', async () => {
    if (!slug) return;
    const target = slug, list = $('history-list');
    list.innerHTML = '<li class="empty">Loading</li>';
    closeSheets(); $('history-sheet').hidden = false;
    try {
      const entries = await (await api('/api/history/' + target)).json();
      if (slug !== target) return;
      list.innerHTML = entries.length ? '' : '<li class="empty">No versions yet. Commit makes the first one.</li>';
      for (const e of entries) {
        const when = new Date(e.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
        const where = e.source === 'site' ? 'site commit ' + e.site + ', before the writer' : e.site ? 'site commit ' + e.site : 'kept on this machine';
        const li = document.createElement('li');
        li.innerHTML = '<span class="msg">' + esc(e.message) + '</span><span class="meta">' + esc(when + ' · ' + where) + '</span><button type="button">Restore</button>';
        const button = li.querySelector('button');
        button.addEventListener('click', () => restore(target, e, when, button));
        list.append(li);
      }
    } catch (err) { list.innerHTML = '<li class="empty">' + esc(err.message) + '</li>'; }
  });
  async function restore(target, e, when, button) {
    if (armed !== button) {
      if (armed) armed.textContent = 'Restore';
      armed = button; button.textContent = 'Replace the text?';
      setTimeout(() => { if (armed === button) { armed = null; button.textContent = 'Restore'; } }, 4000);
      return;
    }
    armed = null; button.disabled = true;
    try {
      if (slug !== target || !(await flushDraftForReload())) return;
      await api('/api/history/' + target + '/snapshot', { method: 'POST' });
      const text = await (await api('/api/history/' + target + '/version?id=' + e.id + (e.source === 'site' ? '&source=site' : ''))).text();
      if (slug !== target) return;
      ta.value = text; edited(); save(true);
      $('history-sheet').hidden = true;
      toast('Restored the version from ' + esc(when) + '. Your previous text is in History. Commit puts this version on the site.', 10000);
    } catch (err) { toast('Restore failed: ' + esc(err.message), 8000); }
    finally { button.disabled = false; button.textContent = 'Restore'; }
  }
  $('history-close').addEventListener('click', () => { $('history-sheet').hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheets(); });

  // ---- images: paste or drop to upload ----
  function upload(file) {
    if (!slug) return;
    const target = slug;
    status('Uploading ' + file.name);
    const name = file.name && file.name !== 'image.png' ? file.name : 'image-' + Date.now() + '.' + (file.type.split('/')[1] || 'png');
    api('/api/upload?slug=' + target + '&name=' + encodeURIComponent(name), { method: 'POST', body: file })
      .then(r => r.json()).then(({ url }) => {
        if (slug !== target) { toast('Image uploaded for ' + esc(target) + ': <code>' + esc(url) + '</code>', 7000); return; }
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
  $('help').addEventListener('click', () => { const show = $('sheet').hidden; closeSheets(); $('sheet').hidden = !show; });
  $('sheet-close').addEventListener('click', () => { $('sheet').hidden = true; });

  // ---- start ----
  loadList().then(list => {
    const want = decodeURIComponent(location.hash.slice(1));
    if (want && list.some(d => d.slug === want)) return open(want);
    if (list.length) return open(list[0].slug);
    return api('/api/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Untitled' }) })
      .then(r => r.json()).then(({ slug: s }) => loadList(s).then(() => open(s)));
  }).then(() => connectLiveReload()).catch(err => status('Could not load drafts: ' + err.message));
  checkRemote(true);
})();
