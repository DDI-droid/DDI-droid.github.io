/*! @license GPL-3.0
   Footnotes as lesswrong.com shows them: sidenotes in the right column on wide screens, a hover card
   between phone and wide widths, and a dialog under the reference on phones.

   A port of ForumMagnum (https://github.com/ForumMagnum/ForumMagnum), the code lesswrong.com runs:
     components/contents/SideItems.tsx         side-item placement (measure, sort, push down)
     components/linkPreview/FootnotePreview.tsx sidenote, hover state, hover card, click handling
     components/linkPreview/useFootnoteHTML.ts  footnote contents from the page
     components/linkPreview/FootnoteDialog.tsx  anchored dialog on phones
     components/contents/SideItemLine.tsx       the line marker on narrow screens
     components/widgets/Backdrop.tsx            dimmed backdrop behind the dialog
     components/common/LWPopper.tsx             hover card placement (bottom-start, flip, no overflow guard)
   Their DOM and class names are kept exactly, so their stylesheet (lesswrong.css) styles everything.
   ForumMagnum is GPL-3.0, so this file is too.

   On the site it runs once on load. The writer's preview calls LWFootnotes.mount(article) after each render. */
(function () {
  'use strict';

  const LG = 1280, SM = 600;           // theme.breakpoints.values.lg and .sm
  const OFFSET_TOP = -6;               // <SideItem options={{offsetTop: -6}}>
  const DIALOG_GAP = 8;                // ANCHORED_DIALOG_GAP
  const BACKDROP_FADE_MS = 200;        // BACKDROP_FADE_DURATION_MS

  // bowser.mobile || bowser.tablet
  const isMobile = () => /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet|Silk|Kindle/i.test(navigator.userAgent);

  // lib/utils/domUtil.ts
  function getOffsetChainTop(element) {
    let y = 0, pos = element;
    while (pos) { if (pos.offsetTop) y += pos.offsetTop; pos = pos.offsetParent; }
    return y;
  }

  // useFootnoteHTML.ts: the linked footnote's innerHTML, if it has a <p> or <li> with text.
  function extractFootnoteHTML(href) {
    try {
      const el = document.querySelector(href);
      if (!el || el.hasAttribute('data-truncated') || el.querySelector('[data-truncated]')) return null;
      const text = Array.from(el.querySelectorAll('p, li')).reduce((acc, p) => acc + p.textContent, '').trim();
      return text ? el.innerHTML : null;
    } catch (e) { return null; }
  }

  // FootnotePreview.tsx getFootnoteIndex: data-footnote-index on the reference, else position in the list.
  function getFootnoteIndex(href) {
    const id = /^#fn/.test(href) ? href.substring(3) : null;
    if (!id) return null;
    const ref = document.getElementById('fnref' + id);
    const fromAttr = ref && ref.getAttribute('data-footnote-index');
    if (fromAttr) return fromAttr;
    const li = Array.from(document.querySelectorAll('#fn' + CSS.escape(id))).find(el =>
      el.parentElement && el.parentElement.tagName === 'OL' &&
      (el.parentElement.classList.contains('footnotes') || el.parentElement.classList.contains('footnotes-list')));
    if (!li) return null;
    const ol = li.parentElement, start = parseInt(ol.getAttribute('start') || '1', 10);
    let n = 0;
    for (const child of ol.children) { if (child === li) break; if (child.tagName === 'LI') n++; }
    return String(start + n);
  }

  const contentStyles = (extra) => (extra ? extra + ' ' : '') + 'ContentStyles-base content ContentStyles-postHighlight';
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };

  let state = null;

  function mount(root) {
    unmount();
    root = root || document.getElementById('markdown-content');
    if (!root) return;
    const sidebar = document.querySelector('.SideItems-sidebar');
    const s = state = { root, sidebar, items: [], observers: [], cleanups: [], raf: 0 };

    const links = root.querySelectorAll('.footnote-reference a[href^="#fn"]:not([href^="#fnref"])');
    links.forEach(a => {
      if (a.closest('.FootnotePreview-sidenote')) return;
      const href = a.getAttribute('href');
      const html = extractFootnoteHTML(href);

      // <span>{sideItem anchor span}<a ...>[n]</a></span>, as React renders FootnotePreview.
      const wrap = document.createElement('span'), anchor = document.createElement('span');
      a.replaceWith(wrap); wrap.append(anchor, a); a.setAttribute('class', '');

      const item = { a, anchor, href, html, anchorHovered: false, sidenoteHovered: false, disableHover: false,
        popper: null, container: null, sidenote: null, anchorTop: null, anchorLeft: null, height: null };

      if (html !== null) {
        const index = getFootnoteIndex(href);
        item.container = el('<div class="SideItems-sideItem"><div class="FootnotePreview-sidenote"><div class="' + contentStyles() + '">' +
          '<span class="FootnotePreview-sidenoteWithIndex">' + (index !== null ? '<span class="FootnotePreview-sidenoteIndex">' + index + '.</span>' : '') +
          '<div class="FootnotePreview-sidenoteContent"><div>' + html + '</div><div class="FootnotePreview-overflowFade"></div></div></span></div></div>' +
          '<span class="FootnotePreview-footnoteMobileIndicator"><span class="SideItemLine-sidebarInlineReactMobile">' +
          '<div class="SideItemLine-sidebarInlineReactMobileLine FootnotePreview-lineColor"></div></span></span></div>');
        item.sidenote = item.container.firstChild;
        item.sidenote.addEventListener('mouseover', () => { item.sidenoteHovered = true; update(item); });
        item.sidenote.addEventListener('mouseleave', () => { item.sidenoteHovered = false; update(item); });
        item.container.querySelector('.FootnotePreview-footnoteMobileIndicator').addEventListener('click', ev => onClick(item, ev));
        if (sidebar) sidebar.appendChild(item.container);
      }

      // useHover on the anchor: enabled off touch devices and at sm and up. The hover card is a React child of the
      // anchor, so moving onto it keeps the anchor hovered.
      a.addEventListener('mouseover', () => {
        if (isMobile() || window.innerWidth < SM) return;
        item.anchorHovered = true; update(item);
      });
      a.addEventListener('mouseleave', ev => {
        if (item.popper && ev.relatedTarget && item.popper.contains(ev.relatedTarget)) return;
        item.anchorHovered = false; update(item);
      });
      a.addEventListener('click', ev => onClick(item, ev));
      s.items.push(item);
    });

    if (!s.items.length) return;
    // SideItemsContainer: re-place when the column's contents change size (reflow, images, math, collapsibles);
    // SideItemsSidebar: re-place when a side item changes height (a hovered sidenote expands).
    const schedule = () => { cancelAnimationFrame(s.raf); s.raf = requestAnimationFrame(layout); };
    const contents = new ResizeObserver(schedule);
    contents.observe(root);
    const heights = new ResizeObserver(entries => {
      for (const e of entries) {
        const it = s.items.find(i => i.container === e.target);
        if (it && it.height && Math.abs(it.height - e.contentRect.height) >= 1.0) { schedule(); break; }
      }
    });
    s.items.forEach(it => it.container && heights.observe(it.container));
    s.observers.push(contents, heights);
    const onResize = () => { schedule(); s.items.forEach(it => update(it)); };
    window.addEventListener('resize', onResize);
    window.addEventListener('load', schedule);
    s.cleanups.push(() => { window.removeEventListener('resize', onResize); window.removeEventListener('load', schedule); });
    if (document.fonts) document.fonts.ready.then(() => { if (state === s) schedule(); });
    layout();
  }

  function unmount() {
    const s = state;
    if (!s) return;
    cancelAnimationFrame(s.raf);
    s.observers.forEach(o => o.disconnect());
    s.cleanups.forEach(f => f());
    s.items.forEach(it => { if (it.container) it.container.remove(); if (it.popper) it.popper.remove(); });
    closeDialog(true);
    state = null;
  }

  // SideItemsSidebar's effect: measure everything first, then write.
  function layout() {
    const s = state;
    if (!s || !s.sidebar) return;
    const items = s.items.filter(it => it.container);
    if (!items.length) return;
    const sidebarColumnTop = getOffsetChainTop(s.sidebar);
    for (const it of items) if (it.container.parentNode !== s.sidebar) s.sidebar.appendChild(it.container);
    for (const it of items) {
      let anchorEl = it.anchor;
      // Inside hidden content (a closed collapsible), place beside the nearest visible ancestor.
      if (anchorEl.offsetParent === null && anchorEl !== document.body && anchorEl.isConnected) {
        let ancestor = anchorEl.parentElement;
        while (ancestor && ancestor.offsetParent === null && ancestor !== document.body) ancestor = ancestor.parentElement;
        if (ancestor) anchorEl = ancestor;
      }
      it.anchorTop = getOffsetChainTop(anchorEl) - sidebarColumnTop + OFFSET_TOP;
      it.anchorLeft = anchorEl.offsetLeft;
      it.height = it.container.clientHeight;
    }
    const sorted = items.slice().sort((x, y) => x.anchorTop - y.anchorTop || x.anchorLeft - y.anchorLeft);
    const sidebarColumnHeight = s.sidebar.clientHeight;
    let top = 0;
    for (const it of sorted) {
      const p = Math.max(top, it.anchorTop);
      it.container.setAttribute('style', 'top:' + p + 'px; --sidebar-column-remaining-height: ' + (sidebarColumnHeight - p) + 'px');
      top = p + it.height;
    }
  }

  // FootnotePreview's render: hover classes on both ends, and the hover card when there is no sidenote to show.
  function update(item) {
    const either = item.anchorHovered || item.sidenoteHovered;
    if (item.sidenote) item.sidenote.classList.toggle('FootnotePreview-sidenoteHover', either);
    item.a.setAttribute('class', either ? 'FootnotePreview-anchorHover' : '');
    const sidenoteIsVisible = !!(state && state.sidebar) && window.innerWidth >= LG;
    const open = item.html !== null && !item.disableHover && item.anchorHovered && !sidenoteIsVisible;
    if (open && !item.popper) openPopper(item);
    else if (!open && item.popper) { item.popper.remove(); item.popper = null; }
  }

  // LWPopper, placement bottom-start with flip, overflow allowed; content is a Card holding the footnote.
  function openPopper(item) {
    const p = el('<div class="LWPopper-default" data-popper-reference-hidden="false" data-popper-escaped="false" data-popper-placement="bottom-start"><div>' +
      '<div class="MuiPaper-root MuiPaper-rounded MuiPaper-elevation1 Card-root Card-lw"><div class="' + contentStyles('FootnotePreview-hovercard') + '">' +
      '<div>' + item.html + '</div></div></div></div></div>');
    p.style.position = 'absolute'; p.style.left = '0px'; p.style.top = '0px';
    popperContainer().appendChild(p);
    item.popper = p;
    const place = () => {
      if (!p.isConnected) return;
      const r = item.a.getBoundingClientRect(), h = p.offsetHeight;
      const below = r.bottom + h <= window.innerHeight, above = r.top - h >= 0;
      const flip = !below && above;
      p.setAttribute('data-popper-placement', flip ? 'top-start' : 'bottom-start');
      // Popper rounds offsets to whole pixels.
      p.style.left = Math.round(r.left + window.scrollX) + 'px';
      p.style.top = Math.round((flip ? r.top - h : r.bottom) + window.scrollY) + 'px';
    };
    place();
    new ResizeObserver(place).observe(p);
    p.firstChild.addEventListener('click', ev => ev.stopPropagation()); // InteractionWrapper
    p.addEventListener('mouseover', () => { item.anchorHovered = true; update(item); });
    p.addEventListener('mouseleave', ev => {
      if (ev.relatedTarget && item.a.contains(ev.relatedTarget)) return;
      item.anchorHovered = false; update(item);
    });
  }

  // PopperPortalContainer: a plain div at the end of the page that hover cards render into.
  function popperContainer() {
    let c = document.getElementById('lw-popper-portal');
    if (!c) { c = document.createElement('div'); c.id = 'lw-popper-portal'; document.body.appendChild(c); }
    return c;
  }

  // FootnotePreview onClick: on phones and narrow screens open the dialog; otherwise follow the link.
  function onClick(item, ev) {
    const isRegularClick = ev.button === 0 && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && !ev.altKey;
    const openModalOnClick = isMobile() || window.innerWidth < SM;
    if (isRegularClick && openModalOnClick && item.html !== null) {
      item.disableHover = true; update(item);
      openDialog(item);
      ev.preventDefault();
    }
  }

  // FootnoteDialog (anchored): a Paper just below the reference that scrolls with the page, over a Backdrop.
  let dialog = null;
  function openDialog(item) {
    closeDialog(true);
    const backdrop = document.createElement('div');
    backdrop.className = 'Backdrop-root';
    backdrop.style.transitionDuration = BACKDROP_FADE_MS + 'ms';
    const wrapper = el('<div class="FootnoteDialog-anchoredWrapper"><div class="MuiPaper-root MuiPaper-rounded MuiPaper-elevation24 FootnoteDialog-anchoredPaper">' +
      '<div class="' + contentStyles('FootnoteDialog-content') + '"><div>' + item.html + '</div></div></div></div>');
    wrapper.style.top = (item.a.getBoundingClientRect().bottom + window.scrollY + DIALOG_GAP) + 'px';
    const d = dialog = { backdrop, wrapper, timer: null };
    setTimeout(() => {
      if (dialog !== d) return;
      document.body.appendChild(backdrop);
      backdrop.getBoundingClientRect(); // forceStyleRecalc, so the fade runs
      backdrop.classList.add('Backdrop-visible');
    }, 0);
    document.body.appendChild(wrapper);
    const onKey = e => { if (e.key === 'Escape') closeDialog(false); };
    const onAway = e => { if (!wrapper.contains(e.target)) closeDialog(false); };
    document.addEventListener('keydown', onKey);
    setTimeout(() => { document.addEventListener('click', onAway); document.addEventListener('touchend', onAway); }, 0);
    d.cleanup = () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onAway); document.removeEventListener('touchend', onAway);
    };
  }
  // The contents go at once; the backdrop fades out, then goes.
  function closeDialog(now) {
    const d = dialog;
    if (!d) return;
    dialog = null;
    d.cleanup && d.cleanup();
    d.wrapper.remove();
    if (now) { d.backdrop.remove(); return; }
    d.backdrop.classList.remove('Backdrop-visible');
    setTimeout(() => d.backdrop.remove(), BACKDROP_FADE_MS);
  }

  window.LWFootnotes = { mount, unmount, layout: () => layout() };
  if (!window.LW_FOOTNOTES_MANUAL) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mount());
    else mount();
  }
})();
