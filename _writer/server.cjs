// The writer: a local server for writing posts. Open http://localhost:4400
//   left pane:  Markdown source of a draft (autosaved to _writer/drafts/<slug>.md)
//   right pane: the site's real post page, re-rendered as you type
//   Publish:    writes _posts/<date>-<slug>.html (rendered with the same renderer); nothing is pushed.
// Listens on 127.0.0.1 only.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { render, splitFrontMatter } = require('./render.js');

const PORT = Number(process.env.PORT) || 4400;
const HERE = __dirname;
const SITE = path.resolve(HERE, '..');
const DRAFTS = path.join(HERE, 'drafts');
const STATIC = path.join(HERE, 'static');
const NM = path.join(HERE, 'node_modules');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.md': 'text/plain; charset=utf-8'
};
const VENDOR = {
  'markdown-it.js': 'markdown-it/dist/markdown-it.min.js',
  'markdown-it-footnote.js': 'markdown-it-footnote/dist/markdown-it-footnote.min.js',
  'markdown-it-container.js': 'markdown-it-container/dist/markdown-it-container.min.js',
  'codemirror.js': 'codemirror/lib/codemirror.js',
  'codemirror.css': 'codemirror/lib/codemirror.css',
  'markdown-mode.js': 'codemirror/mode/markdown/markdown.js',
  'gfm-mode.js': 'codemirror/mode/gfm/gfm.js',
  'overlay.js': 'codemirror/addon/mode/overlay.js',
  'yaml-mode.js': 'codemirror/mode/yaml/yaml.js',
  'yaml-frontmatter.js': 'codemirror/mode/yaml-frontmatter/yaml-frontmatter.js',
  'runmode.js': 'codemirror/addon/runmode/runmode.js'
};

const safeSlug = s => /^[a-z0-9][a-z0-9-]{0,80}$/.test(s) ? s : null;
const send = (res, code, body, type) => { res.writeHead(code, { 'content-type': type || 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); res.end(body); };
const json = (res, code, obj) => send(res, code, JSON.stringify(obj), 'application/json');
function sendFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'not found');
    send(res, 200, data, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
}
// Resolve a URL path under a root, refusing anything that escapes it.
function under(root, rel) {
  const p = path.resolve(root, '.' + path.sep + decodeURIComponent(rel));
  return p.startsWith(root + path.sep) ? p : null;
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function newDraft(title) {
  return '---\ntitle: ' + title + '\ndescription: \ndate: ' + today() + '\ntags: \ncategories: research\n---\n\nStart writing here.\n';
}
function listDrafts() {
  if (!fs.existsSync(DRAFTS)) fs.mkdirSync(DRAFTS, { recursive: true });
  return fs.readdirSync(DRAFTS).filter(f => f.endsWith('.md')).map(f => {
    const slug = f.slice(0, -3), file = path.join(DRAFTS, f);
    const { meta } = splitFrontMatter(fs.readFileSync(file, 'utf8'));
    return { slug, title: meta.title || slug, mtime: fs.statSync(file).mtimeMs };
  }).sort((a, b) => b.mtime - a.mtime);
}

// Publishing: front matter for Jekyll, then the rendered HTML (raw, so Liquid leaves it alone).
const yamlStr = s => JSON.stringify(String(s));
function publish(slug) {
  const src = fs.readFileSync(path.join(DRAFTS, slug + '.md'), 'utf8');
  const out = render(src, { sourceLines: false });
  const m = out.meta;
  if (!m.title) throw new Error('the draft needs a title');
  const date = /^\d{4}-\d{2}-\d{2}/.test(m.date || '') ? m.date.slice(0, 10) : today();
  const list = v => [].concat(v || []).join(' ').trim();
  // Jekyll skips posts dated in the future at build time, and the site has no timezone (UTC).
  // Date the post at midnight UTC of its day, or now if that is still ahead, so it is never skipped.
  let when = new Date(date + 'T00:00:00Z');
  if (when > new Date()) when = new Date();
  const stamp = when.toISOString().replace('T', ' ').slice(0, 19) + ' +0000';
  const fm = ['---', 'layout: post', 'title: ' + yamlStr(m.title), 'date: ' + stamp];
  if (m.description) fm.push('description: ' + yamlStr(m.description));
  if (list(m.tags)) fm.push('tags: ' + list(m.tags));
  if (list(m.categories)) fm.push('categories: ' + list(m.categories));
  if (m.og_image) fm.push('og_image: ' + m.og_image);
  fm.push('related_posts: false', '---', '');
  let body = out.html;
  if (out.hasBuild) {
    body += '<style>\n' + fs.readFileSync(path.join(STATIC, 'build-player.css'), 'utf8') + '</style>\n' +
      '<script>\n' + fs.readFileSync(path.join(STATIC, 'build-player.js'), 'utf8') + '</script>\n';
  }
  const target = path.join(SITE, '_posts', date + '-' + slug + '.html');
  // Remove an earlier publish of the same slug under another date.
  for (const f of fs.readdirSync(path.join(SITE, '_posts'))) {
    if (f.endsWith('-' + slug + '.html') && f !== path.basename(target)) fs.unlinkSync(path.join(SITE, '_posts', f));
  }
  fs.writeFileSync(target, fm.join('\n') + '{% raw %}\n' + body + '{% endraw %}\n');
  return { file: path.relative(SITE, target).replace(/\\/g, '/'), url: '/blog/' + date.slice(0, 4) + '/' + slug + '/' };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return sendFile(res, path.join(STATIC, 'editor.html'));
    if (req.method === 'GET' && p === '/preview') return sendFile(res, path.join(STATIC, 'shell.html'));
    if (req.method === 'GET' && p === '/_writer/render.js') return sendFile(res, path.join(HERE, 'render.js'));
    if (req.method === 'GET' && p === '/_writer/README.md') return sendFile(res, path.join(HERE, 'README.md'));
    if (req.method === 'GET' && p.startsWith('/_writer/')) { const f = under(STATIC, p.slice(9)); return f ? sendFile(res, f) : send(res, 403, 'no'); }
    if (req.method === 'GET' && p.startsWith('/vendor/')) { const v = VENDOR[p.slice(8)]; return v ? sendFile(res, path.join(NM, v)) : send(res, 404, 'not found'); }
    if (req.method === 'GET' && p.startsWith('/assets/')) { const f = under(path.join(SITE, 'assets'), p.slice(8)); return f ? sendFile(res, f) : send(res, 403, 'no'); }
    if (req.method === 'GET' && p === '/favicon.ico') return sendFile(res, path.join(SITE, 'assets', 'img', 'favicon.svg'));

    if (p === '/api/drafts' && req.method === 'GET') return json(res, 200, listDrafts());
    if (p === '/api/drafts' && req.method === 'POST') {
      const { title } = JSON.parse((await readBody(req, 1e4)).toString() || '{}');
      const base = (title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled';
      let slug = base, n = 2;
      while (fs.existsSync(path.join(DRAFTS, slug + '.md'))) slug = base + '-' + n++;
      fs.writeFileSync(path.join(DRAFTS, slug + '.md'), newDraft(title || 'Untitled'));
      return json(res, 200, { slug });
    }
    let m = /^\/api\/drafts\/([^/]+)$/.exec(p);
    if (m) {
      const slug = safeSlug(m[1]); if (!slug) return send(res, 400, 'bad slug');
      const file = path.join(DRAFTS, slug + '.md');
      if (req.method === 'GET') return fs.existsSync(file) ? send(res, 200, fs.readFileSync(file)) : send(res, 404, 'no draft');
      if (req.method === 'PUT') { fs.writeFileSync(file, await readBody(req, 5e6)); return json(res, 200, { saved: Date.now() }); }
    }
    m = /^\/api\/publish\/([^/]+)$/.exec(p);
    if (m && req.method === 'POST') {
      const slug = safeSlug(m[1]); if (!slug) return send(res, 400, 'bad slug');
      return json(res, 200, publish(slug));
    }
    if (p === '/api/upload' && req.method === 'POST') {
      const slug = safeSlug(url.searchParams.get('slug') || ''); if (!slug) return send(res, 400, 'bad slug');
      const ext = (/\.(png|jpe?g|gif|webp|svg|mp4|webm)$/i.exec(url.searchParams.get('name') || '') || [, 'png'])[1].toLowerCase();
      const dir = path.join(SITE, 'assets', 'img', 'posts', slug);
      fs.mkdirSync(dir, { recursive: true });
      const base = (url.searchParams.get('name') || 'image').replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'image';
      let name = base + '.' + ext, n = 2;
      while (fs.existsSync(path.join(dir, name))) name = base + '-' + n++ + '.' + ext;
      fs.writeFileSync(path.join(dir, name), await readBody(req, 50e6));
      return json(res, 200, { url: '/assets/img/posts/' + slug + '/' + name });
    }
    send(res, 404, 'not found');
  } catch (err) {
    json(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log('writer: http://localhost:' + PORT));
