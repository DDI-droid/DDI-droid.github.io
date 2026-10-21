/* The site's Markdown dialect, rendered to the HTML lesswrong.com emits, so the site's copy of
   their stylesheet styles it the same way. One renderer for both the live preview (browser) and
   publishing (Node): what you see while writing is what gets published.

   Syntax beyond CommonMark (cheat sheet in README.md):
     ## Section, ### Subsection, #### Sub-subsection   (## is LessWrong's section heading)
     $x^2$  inline math        $$ ... $$  display math (own lines)
     Text[^1]  and later  [^1]: the footnote            (indent 4 spaces for more paragraphs)
     ![alt](src "caption")  a figure;  add {width=60%} after it to resize
     | a | b |  tables (GitHub style)
     >! hidden text            a spoiler (each line starts with >!)
     +++ Title  ...  +++        a collapsible section
     ::build /path/base 5 "alt" a stepped figure: base-1.png ... base-5.png with play controls
     a YouTube link alone on a line becomes an embedded video
     <!-- note -->              a note to yourself (Grammarly sees it); never rendered or published
     raw HTML passes through
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('markdown-it'), require('markdown-it-footnote'), require('markdown-it-container'));
  } else {
    root.SiteRender = factory(root.markdownit, root.markdownitFootnote, root.markdownitContainer);
  }
})(typeof self !== 'undefined' ? self : this, function (MarkdownIt, footnote, container) {
  'use strict';

  const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ---- front matter: a small YAML subset (key: value, key: [a, b]) ----
  function splitFrontMatter(src) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
    if (!m) return { meta: {}, body: src, bodyStart: 0 };
    const meta = {};
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
      if (!kv) continue;
      let v = kv[2].trim();
      if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map(x => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      else v = v.replace(/^["'](.*)["']$/, '$1');
      meta[kv[1]] = v;
    }
    return { meta, body: src.slice(m[0].length), bodyStart: m[0].split('\n').length - 1 };
  }

  // ---- source preprocessing, line for line (scroll sync depends on it) ----
  // >! lines become a blockquote whose first line carries a marker; +++ lines become containers.
  const SPOILER = '';
  function preprocess(body) {
    const out = [];
    let inFence = false, fenceMark = '', spoiler = false;
    for (const line of body.split('\n')) {
      const fence = /^\s*(```+|~~~+)/.exec(line);
      if (fence && (!inFence || line.trim().startsWith(fenceMark))) {
        if (!inFence) { inFence = true; fenceMark = fence[1]; } else { inFence = false; }
        spoiler = false; out.push(line); continue;
      }
      if (inFence) { out.push(line); continue; }
      const sp = /^(\s*)>!\s?(.*)$/.exec(line);
      if (sp) { out.push(sp[1] + '> ' + (spoiler ? '' : SPOILER) + sp[2]); spoiler = true; continue; }
      spoiler = false;
      const det = /^\+\+\+\s*(.*)$/.exec(line);
      if (det) { out.push(det[1] ? '::: details ' + det[1] : ':::'); continue; }
      out.push(line);
    }
    return out.join('\n');
  }
  function spoilerPlugin(md) {
    md.core.ruler.push('spoilers', state => {
      const stack = [];
      state.tokens.forEach((t, i) => {
        if (t.type === 'blockquote_open') {
          const inline = state.tokens.slice(i + 1).find(x => x.type === 'inline');
          const isSpoiler = !!inline && inline.content.startsWith(SPOILER);
          if (isSpoiler) {
            inline.content = inline.content.slice(1);
            const first = inline.children.find(c => c.type === 'text');
            if (first) first.content = first.content.replace(SPOILER, '');
            t.meta = { spoiler: true };
          }
          stack.push(t);
        } else if (t.type === 'blockquote_close') {
          const open = stack.pop();
          if (open && open.meta && open.meta.spoiler) t.meta = { spoiler: true };
        }
      });
    });
    const r = md.renderer.rules;
    const open = r.blockquote_open || ((t, i, o, e, s) => s.renderToken(t, i, o));
    const close = r.blockquote_close || ((t, i, o, e, s) => s.renderToken(t, i, o));
    r.blockquote_open = (tokens, i, o, env, s) => tokens[i].meta && tokens[i].meta.spoiler
      ? '<div class="spoilers"' + lineAttr(tokens[i], env) + '>\n' : open(tokens, i, o, env, s);
    r.blockquote_close = (tokens, i, o, env, s) => tokens[i].meta && tokens[i].meta.spoiler ? '</div>\n' : close(tokens, i, o, env, s);
  }

  // ---- math: $...$ inline and $$...$$ display ----
  function mathPlugin(md) {
    md.inline.ruler.after('escape', 'math_inline', (state, silent) => {
      const src = state.src, start = state.pos;
      if (src[start] !== '$' || src[start + 1] === '$') return false;
      const next = src[start + 1];
      if (!next || /\s/.test(next)) return false;
      let pos = start + 1;
      while ((pos = src.indexOf('$', pos)) !== -1) {
        if (src[pos - 1] === '\\') { pos++; continue; }
        if (/\s/.test(src[pos - 1]) || /\d/.test(src[pos + 1] || '')) { pos++; continue; }
        break;
      }
      if (pos === -1) return false;
      if (!silent) { const t = state.push('math_inline', 'span', 0); t.content = src.slice(start + 1, pos); }
      state.pos = pos + 1;
      return true;
    });
    md.block.ruler.after('blockquote', 'math_block', (state, startLine, endLine, silent) => {
      let pos = state.bMarks[startLine] + state.tShift[startLine], max = state.eMarks[startLine];
      if (state.src.slice(pos, pos + 2) !== '$$') return false;
      let first = state.src.slice(pos + 2, max).trim();
      let last = '', line = startLine, found = false;
      if (first.endsWith('$$')) { first = first.slice(0, -2).trim(); found = true; }
      if (silent) return true;
      while (!found) {
        line++;
        if (line >= endLine) break;
        pos = state.bMarks[line] + state.tShift[line]; max = state.eMarks[line];
        const text = state.src.slice(pos, max);
        if (text.trim().endsWith('$$')) { last = text.trim().slice(0, -2).trim(); found = true; break; }
      }
      const content = (first ? first + '\n' : '') + state.getLines(startLine + 1, line, state.tShift[startLine], true) + (last ? last : '');
      const t = state.push('math_block', 'div', 0);
      t.block = true; t.content = content.trim(); t.map = [startLine, line + 1];
      state.line = line + 1;
      return true;
    }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
    md.renderer.rules.math_inline = (tokens, i) => '<span class="math-tex">\\(' + escapeHtml(tokens[i].content) + '\\)</span>';
    md.renderer.rules.math_block = (tokens, i, opts, env) =>
      '<div class="math-tex math-display"' + lineAttr(tokens[i], env) + '>\\[' + escapeHtml(tokens[i].content) + '\\]</div>\n';
  }

  // ---- <!-- notes -->: kept in the source for the writer (and Grammarly), dropped from the page ----
  const COMMENT = /<!--[\s\S]*?-->/g;
  function notesPlugin(md) {
    md.core.ruler.after('inline', 'strip_notes', state => {
      const t = state.tokens;
      for (let i = t.length - 1; i >= 0; i--) {
        if (t[i].type === 'html_block') {
          t[i].content = t[i].content.replace(COMMENT, '');
          if (!t[i].content.trim()) t.splice(i, 1);
        } else if (t[i].type === 'inline' && t[i].children) {
          t[i].children = t[i].children.filter(c => !(c.type === 'html_inline' && /^<!--[\s\S]*-->$/.test(c.content)));
        }
      }
    });
  }

  // ---- ::build lines: stepped figures ----
  function buildPlugin(md) {
    md.block.ruler.before('paragraph', 'build', (state, startLine, endLine, silent) => {
      const pos = state.bMarks[startLine] + state.tShift[startLine], max = state.eMarks[startLine];
      const m = /^::build\s+(\S+)\s+(\d+)(?:\s+"([^"]*)")?\s*$/.exec(state.src.slice(pos, max));
      if (!m) return false;
      if (silent) return true;
      const t = state.push('build', 'div', 0);
      t.meta = { base: m[1], n: m[2], alt: m[3] || '' }; t.map = [startLine, startLine + 1];
      state.line = startLine + 1;
      return true;
    });
    md.renderer.rules.build = (tokens, i, opts, env) => {
      const b = tokens[i].meta;
      env.hasBuild = true;
      return '<div class="plm-build" data-base="' + escapeHtml(b.base) + '" data-n="' + b.n + '" data-alt="' + escapeHtml(b.alt) + '"' + lineAttr(tokens[i], env) + '></div>\n';
    };
  }

  // Source-line attributes for the preview's scroll sync; never in published HTML.
  function lineAttr(token, env) {
    return env && env.sourceLines && token.map ? ' data-line="' + (token.map[0] + (env.lineOffset || 0)) + '"' : '';
  }

  const slugify = s => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
  const youtubeId = url => {
    const m = /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/.exec(url);
    return m && m[1];
  };

  function create() {
    const md = MarkdownIt({ html: true, linkify: true, typographer: true, breaks: false });
    md.disable('replacements'); // keep smart quotes; never turn -- or --- into dashes
    md.use(footnote);
    md.use(mathPlugin);
    md.use(buildPlugin);
    md.use(spoilerPlugin);
    md.use(notesPlugin);
    md.use(container, 'details', {
      validate: params => /^details\s+.+/.test(params.trim()),
      render: (tokens, i) => {
        if (tokens[i].nesting !== 1) return '</div></details>\n';
        const title = tokens[i].info.trim().replace(/^details\s+/, '');
        return '<details class="detailsBlock"><summary class="detailsBlockTitle"><p>' + md.renderInline(title) +
          '</p></summary><div class="detailsBlockContent">\n';
      }
    });

    const r = md.renderer.rules;
    const attrLine = (name) => {
      const orig = r[name] || ((t, i, o, e, s) => s.renderToken(t, i, o));
      r[name] = (tokens, i, opts, env, self) => {
        if (env.sourceLines && tokens[i].map) tokens[i].attrSet('data-line', String(tokens[i].map[0] + (env.lineOffset || 0)));
        return orig(tokens, i, opts, env, self);
      };
    };
    ['paragraph_open', 'heading_open', 'blockquote_open', 'bullet_list_open', 'ordered_list_open', 'hr', 'code_block', 'fence', 'html_block']
      .forEach(attrLine);

    // Headings get kramdown-style ids, as on the rest of the site.
    const headingOpen = r.heading_open;
    r.heading_open = (tokens, i, opts, env, self) => {
      const inline = tokens[i + 1];
      if (inline && !tokens[i].attrGet('id')) {
        let id = slugify(inline.content), n = 1;
        env.ids = env.ids || {};
        while (env.ids[id]) id = slugify(inline.content) + '-' + n++;
        env.ids[id] = true;
        tokens[i].attrSet('id', id);
      }
      return headingOpen(tokens, i, opts, env, self);
    };

    // Tables sit in a figure, as on LessWrong. A header row of empty cells means "no header".
    r.table_open = (tokens, i, opts, env) => '<figure class="table"' + lineAttr(tokens[i], env) + '><table>\n';
    r.table_close = () => '</table></figure>\n';
    md.core.ruler.after('inline', 'headerless_tables', state => {
      const t = state.tokens;
      for (let i = 0; i < t.length; i++) {
        if (t[i].type !== 'thead_open') continue;
        let j = i; while (t[j].type !== 'thead_close') j++;
        const cells = t.slice(i, j).filter(x => x.type === 'inline');
        if (cells.length && cells.every(c => !c.content.trim())) { t.splice(i, j - i + 1); }
      }
    });
    // Tables written in HTML (for styles, merged cells, row headers, several paragraphs in a cell)
    // still take $math$, [^1] footnotes and *emphasis* inside: the block is parsed as inline Markdown,
    // where its tags pass through as inline HTML. Runs before inline parsing, so footnotes number in order.
    md.core.ruler.before('inline', 'html_tables', state => {
      for (const t of state.tokens) {
        if (t.type === 'html_block' && /^\s*<(?:figure class="table"|table[\s>])/.test(t.content)) {
          t.type = 'inline'; t.children = []; t.content = t.content.trim();
        }
      }
    });

    // Footnotes in LessWrong's markup: superscript [n] references, a numbered section with ^ back links.
    const fid = (tokens, i) => 'x' + (tokens[i].meta.id + 1);
    r.footnote_ref = (tokens, i) => {
      const n = tokens[i].meta.id + 1, id = fid(tokens, i), sub = tokens[i].meta.subId;
      const refId = 'fnref' + id + (sub > 0 ? '-' + sub : '');
      return '<span class="footnote-reference" data-footnote-reference="" data-footnote-id="' + id + '" data-footnote-index="' + n +
        '" role="doc-noteref" id="' + refId + '"><sup><a href="#fn' + id + '">[' + n + ']</a></sup></span>';
    };
    r.footnote_block_open = () => '<ol class="footnote-section footnotes" data-footnote-section="" role="doc-endnotes">\n';
    r.footnote_block_close = () => '</ol>\n';
    r.footnote_open = (tokens, i) => {
      const n = tokens[i].meta.id + 1, id = fid(tokens, i);
      return '<li class="footnote-item" data-footnote-item="" data-footnote-id="' + id + '" data-footnote-index="' + n +
        '" role="doc-endnote" id="fn' + id + '"><span class="footnote-back-link" data-footnote-back-link="" data-footnote-id="' + id +
        '"><sup><strong><a href="#fnref' + id + '">^</a></strong></sup></span><div class="footnote-content" data-footnote-content="">';
    };
    r.footnote_close = () => '</div></li>\n';
    r.footnote_anchor = () => '';

    // A paragraph holding only an image becomes a figure (title = caption, {width=NN%} resizes);
    // a paragraph holding only a YouTube link becomes an embedded video.
    md.core.ruler.push('figures', state => {
      const tokens = state.tokens;
      for (let i = 0; i < tokens.length - 2; i++) {
        if (tokens[i].type !== 'paragraph_open' || tokens[i + 1].type !== 'inline' || tokens[i + 2].type !== 'paragraph_close') continue;
        const kids = tokens[i + 1].children.filter(k => !(k.type === 'text' && !k.content.trim()) && k.type !== 'softbreak');
        let html = null;
        if (kids[0] && kids[0].type === 'image' && (kids.length === 1 || (kids.length === 2 && kids[1].type === 'text' && /^\{width=\d+%\}$/.test(kids[1].content.trim())))) {
          const img = kids[0];
          const width = kids[1] ? /\d+%/.exec(kids[1].content)[0] : null;
          const src = img.attrGet('src'), title = img.attrGet('title');
          const alt = img.children ? img.children.map(c => c.content).join('') : img.content;
          html = '<figure class="image' + (width ? ' image_resized" style="width:' + width : '') + '"' + lineAttr(tokens[i], state.env) + '>' +
            '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(alt) + '">' +
            (title ? '<figcaption>' + md.renderInline(title) + '</figcaption>' : '') + '</figure>\n';
        } else if (kids.length === 3 && kids[0].type === 'link_open' && kids[2].type === 'link_close' && youtubeId(kids[0].attrGet('href'))) {
          const url = kids[0].attrGet('href');
          html = '<figure class="media"' + lineAttr(tokens[i], state.env) + '><div data-oembed-url="' + escapeHtml(url) + '"><div><iframe src="https://www.youtube.com/embed/' +
            youtubeId(url) + '" allow="autoplay; encrypted-media" allowfullscreen=""></iframe></div></div></figure>\n';
        }
        if (html !== null) {
          const t = new state.Token('html_block', '', 0);
          t.content = html; t.block = true;
          tokens.splice(i, 3, t);
        }
      }
    });
    return md;
  }

  let instance = null;
  // render(source, {sourceLines}) -> {html, meta, hasMath, hasBuild, words}
  function render(src, options) {
    const opts = options || {};
    const { meta, body, bodyStart } = splitFrontMatter(src.replace(/\r\n/g, '\n'));
    instance = instance || create();
    // Smart quotes are on unless the front matter says smartquotes: false.
    instance.options.typographer = String(meta.smartquotes) !== 'false';
    const env = { sourceLines: !!opts.sourceLines, lineOffset: bodyStart };
    // Preprocessing changes no line counts, so source lines stay aligned for scroll sync.
    const html = instance.render(preprocess(body), env);
    const words = (body.replace(COMMENT, ' ').replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g, ' x ').match(/[A-Za-z0-9’']+/g) || []).length;
    return { html, meta, hasMath: /\\\(|\\\[/.test(html), hasBuild: !!env.hasBuild, words };
  }

  return { render, splitFrontMatter, slugify };
});
