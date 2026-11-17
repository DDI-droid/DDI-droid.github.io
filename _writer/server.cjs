// The writer: a local server for writing posts. Open http://localhost:4400
//   left pane:  Markdown source of a post (autosaved to _writer/drafts/<slug>.md)
//   right pane: the site's real post page, re-rendered as you type
//   Commit:     writes the post into _posts, commits it with its images to the site repository and pushes.
//               The source, notes included, gets a version in _writer/.history, which never leaves this machine.
//   Posts already on the site come in as drafts, and follow their file in _posts when it changes elsewhere.
// Listens on 127.0.0.1 only.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
let { render, splitFrontMatter } = require('./render.js');

const PORT = Number(process.env.PORT) || 4400;
const HERE = __dirname;
const SITE = path.resolve(process.env.WRITER_SITE || path.resolve(HERE, '..'));
const DRAFTS = path.resolve(process.env.WRITER_DRAFTS || path.join(HERE, 'drafts'));
const HISTORY = path.resolve(process.env.WRITER_HISTORY || path.join(HERE, '.history'));
// Agent edits wait here while the author is typing; they are merged in after a minute without typing.
const INCOMING = path.resolve(process.env.WRITER_INCOMING || path.join(HERE, '.incoming'));
const POSTS = path.join(SITE, '_posts');
const PAGES = path.join(SITE, '_pages');
const PAGE_NAMES = (process.env.WRITER_PAGES || 'projects,academics').split(',').map(s => s.trim()).filter(Boolean);
const STATIC = path.join(HERE, 'static');
const NM = path.join(HERE, 'node_modules');
const SITE_URL = (() => {
  try { return (/^url:\s*(\S+)/m.exec(fs.readFileSync(path.join(SITE, '_config.yml'), 'utf8')) || [, ''])[1].replace(/\/$/, ''); }
  catch { return ''; }
})();

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
const draftHash = data => crypto.createHash('sha1').update(data).digest('hex').slice(0, 16);
const send = (res, code, body, type) => { res.writeHead(code, { 'content-type': type || 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); res.end(body); };
const json = (res, code, obj) => send(res, code, JSON.stringify(obj), 'application/json');
function sendFile(res, file) {
  // Loaded studio dependencies participate automatically too; a future script or
  // stylesheet does not need its own hard-coded watcher.
  if (file.startsWith(STATIC + path.sep)) track(file, 'tools', '/_writer/' + path.relative(STATIC, file).replace(/\\/g, '/'));
  if (file.startsWith(NM + path.sep)) track(file, 'tools', '/vendor/' + path.relative(NM, file).replace(/\\/g, '/'));
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'not found');
    // A document and its initial reload state share a baseline, so a change during
    // page startup is detected by the first stream snapshot rather than lost.
    if (file === path.join(STATIC, 'editor.html') || file === path.join(STATIC, 'shell.html')) {
      const baseline = JSON.stringify(reloadState()).replace(/</g, '\\u003c');
      data = data.toString('utf8').replace(/<head>/i, '<head><script>window.__writerLiveState=' + baseline + ';</script>');
    }
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

// One dependency monitor and revision protocol for both studio code and site assets.
// Stat reconciliation is deliberate: native directory notifications are not reliable
// across Windows/WSL writes and atomic replacements. Only served assets are tracked.
const liveClients = new Set(), resources = new Map();
const instance = crypto.randomUUID();
let revision = 0, toolsRevision = 0, assetsRevision = 0, lastChange = null;
const fileStamp = file => {
  try { const s = fs.statSync(file); return [s.mtimeMs, s.ctimeMs, s.size, s.ino].join(':'); }
  catch { return 'missing'; }
};
function track(file, kind, url) {
  if (!resources.has(file)) resources.set(file, { kind, url, stamp: fileStamp(file), pending: null });
}
for (const name of ['render.js', 'static/editor.html', 'static/editor.css', 'static/editor.js',
  'static/shell.html', 'static/bridge.js', 'static/live-reload.js', 'static/build-player.css', 'static/build-player.js']) {
  track(path.join(HERE, name), 'tools', name);
}
function reloadState() {
  return { instance, revision, tools: toolsRevision, assets: assetsRevision, lastChange };
}
function sendReloadState(res) {
  const state = reloadState();
  res.write('id: ' + instance + ':' + revision + '\nevent: state\ndata: ' + JSON.stringify(state) + '\n\n');
}
setInterval(() => {
  const changed = [];
  for (const [file, record] of resources) {
    const stamp = fileStamp(file);
    if (stamp === record.stamp) { record.pending = null; continue; }
    // Require two matching observations before announcing a replacement, so an
    // exporter writing in chunks is not announced on the first partial write.
    if (record.pending !== stamp) { record.pending = stamp; continue; }
    changed.push([file, record, stamp]);
  }
  if (!changed.length) return;
  if (changed.some(([file]) => file === path.join(HERE, 'render.js'))) {
    try {
      const modulePath = require.resolve('./render.js');
      delete require.cache[modulePath];
      ({ render, splitFrontMatter } = require('./render.js'));
    } catch (err) {
      console.error('[writer] renderer reload failed; keeping previous renderer:', err.message);
      return;
    }
  }
  for (const [, record, stamp] of changed) { record.stamp = stamp; record.pending = null; }
  revision++;
  if (changed.some(([, r]) => r.kind === 'tools')) toolsRevision++;
  if (changed.some(([, r]) => r.kind === 'assets')) assetsRevision++;
  lastChange = { time: new Date().toISOString(), files: changed.map(([, r]) => ({ kind: r.kind, url: r.url })) };
  console.log('[writer:reload]', revision, JSON.stringify(lastChange.files));
  for (const res of liveClients) {
    try { sendReloadState(res); }
    catch { liveClients.delete(res); }
  }
}, 400).unref();

function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function newDraft(title) {
  return '---\ntitle: ' + title + '\ndescription: \ndate: ' + today() + '\ntags: \ncategories: research\n---\n\nStart writing here.\n';
}
const lf = s => String(s).replace(/\r\n/g, '\n');
const draftFile = slug => path.join(DRAFTS, slug + '.md');
const { merge3 } = require('./merge3.cjs');
const incomingFile = slug => path.join(INCOMING, slug + '.json');
function readQueue(slug) { try { return JSON.parse(fs.readFileSync(incomingFile(slug), 'utf8')); } catch (_) { return []; } }
function writeQueue(slug, q) {
  fs.mkdirSync(INCOMING, { recursive: true });
  if (!q.length) { try { fs.unlinkSync(incomingFile(slug)); } catch (_) {} return; }
  const tmp = incomingFile(slug) + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(q)); fs.renameSync(tmp, incomingFile(slug));
}
// slug -> last time an open editor asked about it; an editor polls every 2 s.
const editorSeen = new Map();
const editorOpen = slug => Date.now() - (editorSeen.get(slug) || 0) < 10000;
// With no editor open on the draft, queued agent edits go straight into the file (merged); a clash stays queued.
function applyQueueOnDisk(slug) {
  const file = draftFile(slug), q = readQueue(slug);
  if (!q.length || !fs.existsSync(file)) return;
  const before = fs.readFileSync(file, 'utf8'); let text = before; const left = [];
  for (const it of q) {   // a clashing edit stays queued; the others still go in
    const m = merge3(it.base, text, it.text);
    if (m.conflict) { left.push(Object.assign(it, { conflict: true })); continue; }
    text = m.text;
  }
  if (text !== before) fs.writeFileSync(file, text);
  writeQueue(slug, left);
}
setInterval(() => {
  let names = []; try { names = fs.readdirSync(INCOMING).filter(f => f.endsWith('.json')); } catch (_) { return; }
  for (const f of names) { const slug = safeSlug(f.slice(0, -5)); if (slug && !editorOpen(slug)) { try { applyQueueOnDisk(slug); } catch (_) {} } }
}, 3000).unref();
const readDraft = slug => fs.readFileSync(draftFile(slug), 'utf8');

// ---- git: the site repository, and a private history of post sources ----
function run(args, cwd, timeout) {
  return new Promise(resolve => execFile('git', args, {
    cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeout || 60000, windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  }, (err, stdout, stderr) => resolve({
    code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
    stdout: stdout || '', stderr: String(stderr || (err && err.message) || '').trim()
  })));
}
const git = (args, timeout) => run(args, SITE, timeout);
async function gitOk(args, timeout) {
  const r = await git(args, timeout);
  if (r.code !== 0) throw new Error('git ' + args[0] + ' failed: ' + (r.stderr || r.stdout).trim());
  return r.stdout;
}
// The history is its own repository (_writer/.history over the drafts folder), so sources and their notes are
// versioned without ever entering the site repository that gets pushed.
let identity = null;
async function hist(args, timeout) {
  if (!identity) {
    const name = (await git(['config', 'user.name'])).stdout.trim() || 'Writer';
    const email = (await git(['config', 'user.email'])).stdout.trim() || 'writer@localhost';
    identity = ['-c', 'user.name=' + name, '-c', 'user.email=' + email, '-c', 'core.autocrlf=false'];
  }
  fs.mkdirSync(DRAFTS, { recursive: true });
  if (!fs.existsSync(path.join(HISTORY, 'HEAD'))) {
    fs.mkdirSync(HISTORY, { recursive: true });
    const r = await run(['--git-dir=' + HISTORY, 'init', '--quiet'], DRAFTS);
    if (r.code !== 0) throw new Error('could not create the history: ' + r.stderr);
  }
  return run([...identity, '--git-dir=' + HISTORY, '--work-tree=' + DRAFTS, ...args], DRAFTS, timeout);
}
async function histCommit(slug, message) {
  const name = slug + '.md';
  await hist(['add', '--', name]);
  const r = await hist(['commit', '--quiet', '-m', message, '--', name]);
  if (r.code !== 0 && !/nothing (added )?to commit|no changes added/i.test(r.stdout + r.stderr)) throw new Error('history: ' + (r.stderr || r.stdout).trim());
  return (await hist(['rev-parse', '--short', 'HEAD'])).stdout.trim() || null;
}
// Blob ids, so a file can be compared with its committed version without one git call per file.
const blobHash = text => { const b = Buffer.from(text, 'utf8'); return crypto.createHash('sha1').update('blob ' + b.length + '\0').update(b).digest('hex'); };
async function tree(runner, prefix) {
  const r = await runner(['ls-tree', '-r', 'HEAD', ...(prefix ? ['--', ...[].concat(prefix)] : [])]);
  const map = new Map();
  if (r.code !== 0) return map;
  for (const line of r.stdout.split('\n')) { const m = /^\d+ blob ([0-9a-f]{40})\t(.*)$/.exec(line); if (m) map.set(m[2], m[1]); }
  return map;
}
async function branchInfo() {
  const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
  const up = await git(['rev-parse', '--abbrev-ref', '@{u}']);
  const upstream = up.code === 0 ? up.stdout.trim() : null;
  const ahead = upstream ? Number((await git(['rev-list', '--count', '@{u}..HEAD'])).stdout.trim()) || 0 : 0;
  return { branch, upstream, ahead };
}
// ---- staying in step with GitHub: always pull before pushing ----
async function fetchRemote() {
  const info = await branchInfo();
  if (!info.upstream) return 'the branch ' + info.branch + ' has no remote branch';
  const r = await git(['fetch', '--quiet', info.upstream.slice(0, info.upstream.indexOf('/'))], 90000);
  return r.code === 0 ? null : (r.stderr || r.stdout).trim().split('\n').slice(-2).join(' ') || 'fetch failed';
}
// What GitHub has that this copy does not (and the other way), and which incoming files would block a pull
// because they also have uncommitted changes here.
async function remoteStatus(doFetch) {
  const fetchError = doFetch ? await fetchRemote() : null;
  const info = await branchInfo();
  if (!info.upstream) return { ...info, behind: 0, incoming: [], outgoing: [], incomingFiles: [], blocked: [], fetchError: fetchError || 'no remote branch' };
  const behind = Number((await git(['rev-list', '--count', 'HEAD..@{u}'])).stdout.trim()) || 0;
  const log = async range => (await git(['log', '--format=%h%x09%an%x09%ad%x09%s', '--date=format:%d %b %H:%M', range])).stdout
    .split('\n').filter(Boolean).map(l => { const [id, author, date, subject] = l.split('\t'); return { id, author, date, subject }; });
  const incomingFiles = behind ? (await git(['diff', '--name-only', 'HEAD...@{u}'])).stdout.split('\n').filter(Boolean) : [];
  const blocked = incomingFiles.length ? (await git(['status', '--porcelain', '--', ...incomingFiles])).stdout.split('\n').filter(Boolean).map(l => l.slice(3)) : [];
  return { ...info, behind, incoming: behind ? await log('HEAD..@{u}') : [], outgoing: info.ahead ? await log('@{u}..HEAD') : [],
    incomingFiles, blocked, fetchError, checked: new Date().toISOString() };
}
// Pull without touching uncommitted work: a fast-forward when only GitHub moved, a merge commit when both did.
// Git refuses rather than overwrite a file with local changes; a merge that conflicts is aborted and reported.
async function pull() {
  const st = await remoteStatus(true);
  if (st.fetchError) return { ...st, pulled: false, pullError: 'could not reach GitHub: ' + st.fetchError };
  if (!st.behind) return { ...st, pulled: true, pullError: null, brought: 0 };
  if (st.blocked.length) return { ...st, pulled: false, pullError: 'these files changed on GitHub and also have uncommitted changes here: ' +
    st.blocked.join(', ') + '. Commit or undo them here first, then sync again' };
  const r = await git(st.ahead ? ['merge', '--no-edit', '-m', 'Merge GitHub changes', '@{u}'] : ['merge', '--ff-only', '@{u}'], 120000);
  if (r.code !== 0) {
    if ((await git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'])).code === 0) await git(['merge', '--abort']);
    return { ...(await remoteStatus(false)), pulled: false, pullError: (r.stderr || r.stdout).trim().split('\n').slice(0, 6).join(' ') };
  }
  await syncFromSite().catch(err => console.error('[writer] sync after pull failed:', err.message));
  return { ...(await remoteStatus(false)), pulled: true, pullError: null, brought: st.behind };
}
// Pushing pulls first, then sends every local commit GitHub does not have yet, not only the writer's.
async function push() {
  const pulled = await pull();
  if (!pulled.pulled) return { ...pulled, pushed: false, pushError: 'nothing was pushed, because pulling from GitHub first failed: ' + pulled.pullError };
  const before = await branchInfo();
  if (!before.upstream) return { ...pulled, pushed: false, pushError: 'the branch ' + before.branch + ' has no remote branch to push to' };
  if (!before.ahead) return { ...pulled, pushed: true, pushError: null, sent: 0 };
  const slash = before.upstream.indexOf('/');
  const r = await git(['push', before.upstream.slice(0, slash), 'HEAD:' + before.upstream.slice(slash + 1)], 180000);
  return { ...(await remoteStatus(false)), pulled: true, brought: pulled.brought, pushed: r.code === 0, sent: r.code === 0 ? before.ahead : 0,
    pushError: r.code === 0 ? null : (r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ') };
}

// ---- posts on the site ----
// _posts/<date>-<slug>.html was written by the writer from a draft; _posts/<date>-<slug>.md is a Markdown post
// whose source is the file itself (Jekyll renders it), edited here through a draft of the same name.
const POST_RE = /^(\d{4}-\d{2}-\d{2})-([a-z0-9][a-z0-9-]*)\.(md|markdown|html)$/;
function sitePosts() {
  const map = new Map();
  if (!fs.existsSync(POSTS)) return map;
  for (const f of fs.readdirSync(POSTS).sort()) {
    const m = POST_RE.exec(f); if (!m) continue;
    const entry = { file: '_posts/' + f, format: m[3] === 'html' ? 'html' : 'md', date: m[1] };
    const prev = map.get(m[2]);
    if (!prev || (prev.format === 'html' && entry.format === 'md')) map.set(m[2], entry);
  }
  // Site pages that are not posts (projects, academics) are edited the same way as a Markdown post: a draft named
  // page-<permalink> follows _pages/<file>.md and Commit writes it back there.
  for (const f of fs.existsSync(PAGES) ? fs.readdirSync(PAGES).sort() : []) {
    if (!/\.md$/.test(f)) continue;
    const fm = (splitFrontMatter(fs.readFileSync(path.join(PAGES, f), 'utf8')).meta || {});
    const link = String(fm.permalink || '/' + f.replace(/\.md$/, '') + '/');
    const name = link.replace(/^\/|\/$/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    if (!PAGE_NAMES.includes(name)) continue;
    map.set('page-' + name, { file: '_pages/' + f, format: 'md', date: null, page: true, url: link });
  }
  return map;
}
const postUrl = (slug, date) => '/blog/' + date.slice(0, 4) + '/' + slug + '/';
const targetUrl = (slug, t) => t.page ? t.url : postUrl(slug, t.date);
// Notes are for the writer: a committed Markdown post leaves them out, as the rendered posts do.
// Code blocks and inline code keep theirs; a note on lines of its own goes with its line breaks.
function stripNotes(src) {
  const kept = [];
  const hold = s => '\u0000' + (kept.push(s) - 1) + '\u0000';
  let text = lf(src).replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, hold).replace(/`[^`\n]+`/g, hold);
  text = text.replace(/^[ \t]*<!--(?:(?!-->)[\s\S])*-->[ \t]*\n/gm, '').replace(/[ \t]*<!--[\s\S]*?-->/g, '');
  return text.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[+i]);
}

// A writer post on the site: front matter for Jekyll, then the rendered HTML (raw, so Liquid leaves it alone).
const yamlStr = s => JSON.stringify(String(s));
function htmlPost(slug, src) {
  const out = render(src, { sourceLines: false });
  const m = out.meta;
  if (!m.title) throw new Error('the post needs a title');
  const date = /^\d{4}-\d{2}-\d{2}/.test(String(m.date || '')) ? String(m.date).slice(0, 10) : today();
  const file = '_posts/' + date + '-' + slug + '.html';
  const list = v => [].concat(v || []).join(' ').trim();
  // Jekyll skips posts dated in the future at build time, and the site has no timezone (UTC). Date the post at
  // midnight UTC of its day; while that is still ahead, keep the time it was first written (or now), so a
  // commit made late in the evening in India is not skipped and recommitting it changes nothing.
  let stamp = date + ' 00:00:00 +0000';
  if (new Date(date + 'T00:00:00Z') > new Date()) {
    const existing = path.join(SITE, file);
    const prev = fs.existsSync(existing) && /^date: (.+)$/m.exec(fs.readFileSync(existing, 'utf8'));
    stamp = prev ? prev[1].trim() : new Date().toISOString().replace('T', ' ').slice(0, 19) + ' +0000';
  }
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
  return { file, content: lf(fm.join('\n') + '{% raw %}\n' + body + '{% endraw %}\n'), url: postUrl(slug, date) };
}
// What committing a draft puts on the site: one file in _posts with its content, and any earlier file of the
// same writer post under another date, which it replaces.
function sitePost(slug, src, posts) {
  const t = (posts || sitePosts()).get(slug);
  if (t && t.format === 'md') return { file: t.file, content: stripNotes(src), url: targetUrl(slug, t), stale: [], md: true };
  const p = htmlPost(slug, src);
  const stale = (fs.existsSync(POSTS) ? fs.readdirSync(POSTS) : [])
    .filter(f => f.endsWith('-' + slug + '.html') && '_posts/' + f !== p.file).map(f => '_posts/' + f);
  return { ...p, stale };
}
// Site files a post uses: images, figures, PDFs, the share image, and the frames of stepped figures.
function referencedAssets(src) {
  const urls = new Set();
  for (const m of src.matchAll(/\/assets\/[^\s"'()<>\]\\]+/g)) urls.add(m[0].replace(/[.,;:]+$/, ''));
  for (const m of src.matchAll(/^::build\s+(\/assets\/\S+)\s+(\d+)/gm)) for (let k = 1; k <= Number(m[2]); k++) urls.add(m[1] + '-' + k + '.png');
  const root = path.join(SITE, 'assets') + path.sep, files = [];
  for (const u of urls) {
    let f; try { f = path.join(SITE, decodeURIComponent(u.split(/[?#]/)[0])); } catch { continue; }
    if (f.startsWith(root) && fs.existsSync(f) && fs.statSync(f).isFile()) files.push(path.relative(SITE, f).replace(/\\/g, '/'));
  }
  return [...new Set(files)];
}
// new: never committed to the site; live: the site has what committing would write; changed: it differs.
async function stateOf(out, siteTree) {
  const head = siteTree.get(out.file);
  if (!head) return out.stale.some(f => siteTree.has(f)) ? 'changed' : 'new';
  if (out.stale.some(f => siteTree.has(f))) return 'changed';
  if (head === blobHash(out.content)) return 'live';
  // A Markdown post's own HTML comments count as notes, not as a change: no commit removes only those.
  if (out.md && stripNotes(lf(await gitOk(['show', 'HEAD:' + out.file]))) === out.content) return 'live';
  return 'changed';
}

// Posts already on the site come into the writer: a Markdown post without a draft is imported, and a draft with
// no edits since its last version follows its post file when that changes (a pull, or an edit made elsewhere).
let syncing = null;
const syncFromSite = () => syncing || (syncing = doSync().finally(() => { syncing = null; }));
async function doSync() {
  fs.mkdirSync(DRAFTS, { recursive: true });
  const histTree = await tree(hist), done = [];
  for (const [slug, t] of sitePosts()) {
    if (t.format !== 'md' || !safeSlug(slug)) continue;
    const postFile = path.join(SITE, t.file), draft = draftFile(slug);
    const text = lf(fs.readFileSync(postFile, 'utf8'));
    if (!fs.existsSync(draft)) {
      fs.writeFileSync(draft, text);
      const mtime = fs.statSync(postFile).mtime; fs.utimesSync(draft, mtime, mtime);
      done.push([slug, 'Imported from ' + t.file]);
      continue;
    }
    const mine = fs.readFileSync(draft, 'utf8');
    if (histTree.get(slug + '.md') === blobHash(mine) && text !== mine && stripNotes(mine) !== text) {
      fs.writeFileSync(draft, text);
      done.push([slug, 'Synced from ' + t.file]);
    }
  }
  for (const [slug, message] of done) await histCommit(slug, message);
  if (done.length) console.log('[writer:sync]', done.map(d => d[1]).join('; '));
}

// Both sides moved: a Markdown post or page edited here since its last version while its file on the site also
// changed since then (a pull, or an edit made elsewhere). "Keep mine" is remembered against that site version.
const keptFile = () => path.join(HISTORY, 'writer-kept.json');
const readKept = () => { try { return JSON.parse(fs.readFileSync(keptFile(), 'utf8')); } catch { return {}; } };
async function conflictOf(slug, t, mine, histTree) {
  if (!t || t.format !== 'md') return false;
  const last = histTree.get(slug + '.md');
  if (!last || last === blobHash(mine)) return false;  // no edits of its own here
  const site = lf(fs.readFileSync(path.join(SITE, t.file), 'utf8'));
  if (stripNotes(mine) === site || readKept()[slug] === blobHash(site)) return false;
  const base = (await hist(['show', 'HEAD:' + slug + '.md'])).stdout;
  return stripNotes(lf(base)) !== site && base !== site;
}

async function listDrafts() {
  await syncFromSite().catch(err => console.error('[writer] sync from the site failed:', err.message));
  const posts = sitePosts(), siteTree = await tree(git, ['_posts', '_pages']), histTree = await tree(hist);
  const items = await Promise.all(fs.readdirSync(DRAFTS).filter(f => f.endsWith('.md') && safeSlug(f.slice(0, -3))).map(async f => {
    const slug = f.slice(0, -3), file = path.join(DRAFTS, f), src = fs.readFileSync(file, 'utf8');
    const { meta } = splitFrontMatter(src);
    let state = 'new', conflict = false;
    try { state = await stateOf(sitePost(slug, src, posts), siteTree); } catch {}
    try { conflict = await conflictOf(slug, posts.get(slug), src, histTree); } catch {}
    return { slug, title: (slug.startsWith('page-') ? 'Page: ' : '') + (meta.title || slug), mtime: fs.statSync(file).mtimeMs, state, conflict };
  }));
  return items.sort((a, b) => b.mtime - a.mtime);
}
// Resolve a conflict: take the site's file into the draft (the draft's text is kept as a version first), or keep
// the draft, which the next Commit writes over the site version.
async function takeSite(slug) {
  const t = sitePosts().get(slug);
  if (!t || t.format !== 'md') throw new Error('only Markdown posts and pages have a site version to take');
  await histCommit(slug, 'Before taking the site version of ' + t.file);
  fs.writeFileSync(draftFile(slug), lf(fs.readFileSync(path.join(SITE, t.file), 'utf8')));
  return { version: await histCommit(slug, 'Took the site version of ' + t.file) };
}
function keepMine(slug) {
  const t = sitePosts().get(slug);
  if (!t) throw new Error('no site file for ' + slug);
  const kept = readKept();
  kept[slug] = blobHash(lf(fs.readFileSync(path.join(SITE, t.file), 'utf8')));
  fs.writeFileSync(keptFile(), JSON.stringify(kept, null, 1));
  return { kept: true };
}

// Post files of one slug in _posts: those on disk, and those git has (committed or staged).
async function postFilesOf(slug) {
  const re = new RegExp('^_posts/\\d{4}-\\d{2}-\\d{2}-' + slug + '\\.(md|markdown|html)$');
  const onDisk = (fs.existsSync(POSTS) ? fs.readdirSync(POSTS) : []).map(f => '_posts/' + f).filter(f => re.test(f));
  const known = [...(await tree(git, ['_posts'])).keys(), ...(await git(['ls-files', '--', '_posts'])).stdout.split('\n')].filter(f => re.test(f));
  return { onDisk, known };
}
// Only a post the site has never had can be deleted: not a page, and no post file of it committed or staged.
const deletable = async slug => !slug.startsWith('page-') && !(await postFilesOf(slug)).known.length;
// Delete the draft and any uncommitted post file of it. Both go into the private history first.
async function deleteDraft(slug) {
  const file = draftFile(slug), { onDisk } = await postFilesOf(slug);
  if (!(await deletable(slug))) throw Object.assign(new Error('this post is on the site, so it cannot be deleted here'), { code: 409 });
  await histCommit(slug, 'Before deleting the draft');
  for (const f of onDisk) { fs.writeFileSync(file, fs.readFileSync(path.join(SITE, f))); await histCommit(slug, 'Before deleting ' + f); }
  fs.unlinkSync(file);
  for (const f of onDisk) fs.unlinkSync(path.join(SITE, f));
  await histCommit(slug, 'Deleted the draft');
  return { deleted: slug, files: onDisk };
}

// What Commit would do for one post: its state, the files it would change, and the push it would make.
async function statusOf(slug) {
  const src = readDraft(slug), posts = sitePosts(), siteTree = await tree(git, ['_posts', '_pages']);
  const title = splitFrontMatter(src).meta.title || slug;
  const info = { ...(await branchInfo()), deletable: await deletable(slug) };
  let out;
  try { out = sitePost(slug, src, posts); }
  catch (err) { return { slug, title, state: 'new', error: err.message, files: [], ...info }; }
  const state = await stateOf(out, siteTree);
  const files = [];
  if (state !== 'live') files.push({ path: out.file, change: state === 'new' && !out.stale.length ? 'new' : 'changed' });
  for (const f of out.stale) if (siteTree.has(f)) files.push({ path: f, change: 'removed' });
  const assets = referencedAssets(src);
  if (assets.length) {
    const r = await git(['status', '--porcelain', '--untracked-files=all', '--', ...assets]);
    for (const line of r.stdout.split('\n')) {
      const m = /^(..) (.+)$/.exec(line);
      if (m) files.push({ path: m[2].replace(/^"|"$/g, ''), change: m[1].includes('?') || m[1].includes('A') ? 'new' : 'changed' });
    }
  }
  return { slug, title, state, file: out.file, url: out.url, site: SITE_URL + out.url, files, ...info };
}

// Commit: write the post, commit it and the files it uses (nothing else in the working tree), keep a version of
// the source in the history, then push. One commit at a time.
// Commits, pulls and pushes run one at a time, so two git operations never touch the repository at once.
let committing = Promise.resolve();
function commitQueue(fn) {
  const job = committing.then(fn);
  committing = job.catch(() => {});
  return job;
}
const commitPost = (slug, message) => commitQueue(() => doCommit(slug, message));
async function doCommit(slug, message) {
  const info = await branchInfo();
  if (!info.branch || info.branch === 'HEAD') throw new Error('the site repository is not on a branch');
  const src = readDraft(slug);
  const out = sitePost(slug, src);
  // A post the site already has is not rewritten (so a Markdown post's comments alone never make a commit).
  const unchanged = (await stateOf(out, await tree(git, ['_posts', '_pages']))) === 'live';
  let paths = referencedAssets(src);
  if (!unchanged) {
    fs.mkdirSync(POSTS, { recursive: true });
    fs.writeFileSync(path.join(SITE, out.file), out.content);
    for (const f of out.stale) fs.rmSync(path.join(SITE, f), { force: true });
    const tracked = out.stale.length ? new Set((await git(['ls-files', '--', ...out.stale])).stdout.split('\n').filter(Boolean)) : new Set();
    paths = [out.file, ...out.stale.filter(f => tracked.has(f)), ...paths];
  }
  if (paths.length) {
    const ignored = new Set((await git(['check-ignore', '--', ...paths])).stdout.split('\n').map(s => s.trim()).filter(Boolean));
    paths = paths.filter(p => !ignored.has(p));
  }
  let commit = null;
  // Never run git add or commit without paths: that would take the whole working tree.
  if (paths.length) {
    await gitOk(['add', '-A', '--', ...paths]);
    if ((await git(['diff', '--cached', '--quiet', '--', ...paths])).code === 1) {
      await gitOk(['commit', '--quiet', '--only', '-m', message, '--', ...paths]);
      commit = (await gitOk(['rev-parse', '--short', 'HEAD'])).trim();
    }
  }
  const version = await histCommit(slug, message + (commit ? '\n\nsite ' + commit : ''));
  const pushed = await push();
  return { commit, version, file: out.file, url: out.url, site: SITE_URL + out.url, files: paths, ...pushed };
}

// History: the versions of a source, newest first. A Markdown post also lists its commits from before the writer.
async function historyOf(slug) {
  const entries = [];
  const r = await hist(['log', '--format=%h%x1f%aI%x1f%B%x1e', '--', slug + '.md']);
  if (r.code === 0) for (const rec of r.stdout.split('\x1e')) {
    const [id, date, body] = rec.replace(/^\s+/, '').split('\x1f');
    if (!id || !body) continue;
    entries.push({ id, date, message: body.trim().split('\n')[0], site: (/^site ([0-9a-f]+)$/m.exec(body) || [])[1] || null, source: 'writer' });
  }
  const t = sitePosts().get(slug);
  if (t && t.format === 'md') {
    const first = entries.length ? Date.parse(entries[entries.length - 1].date) : Infinity;
    const s = await git(['log', '--format=%h%x1f%aI%x1f%s%x1e', '--', t.file]);
    if (s.code === 0) for (const rec of s.stdout.split('\x1e')) {
      const [id, date, message] = rec.replace(/^\s+/, '').split('\x1f');
      if (id && Date.parse(date) < first) entries.push({ id, date, message, site: id, source: 'site' });
    }
  }
  return entries;
}
async function versionOf(slug, id, source) {
  if (!/^[0-9a-f]{4,40}$/.test(id)) throw new Error('bad version id');
  if (source === 'site') {
    const t = sitePosts().get(slug);
    if (!t) throw new Error('no post file for ' + slug);
    return lf(await gitOk(['show', id + ':' + t.file]));
  }
  const r = await hist(['show', id + ':' + slug + '.md']);
  if (r.code !== 0) throw new Error(r.stderr || 'no such version');
  return r.stdout;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    const previewMatch = /^\/api\/preview\/([^/]+)$/.exec(p);
    if (req.method === 'GET' && previewMatch) {
      const slug = safeSlug(previewMatch[1]);
      if (!slug) return send(res, 400, 'bad slug');
      const file = draftFile(slug);
      if (!fs.existsSync(file)) return send(res, 404, 'no draft');
      return json(res, 200, render(fs.readFileSync(file, 'utf8'), { sourceLines: true }));
    }
    if (req.method === 'GET' && p === '/_writer/state') return json(res, 200, reloadState());
    if (req.method === 'GET' && p === '/_writer/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-store',
        'connection': 'keep-alive',
        'x-accel-buffering': 'no'
      });
      res.write('retry: 750\n\n');
      liveClients.add(res);
      sendReloadState(res); // Current state, including changes missed while disconnected.
      const heartbeat = setInterval(() => {
        try { sendReloadState(res); } catch { liveClients.delete(res); }
      }, 15000);
      res.on('close', () => { clearInterval(heartbeat); liveClients.delete(res); });
      return;
    }
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return sendFile(res, path.join(STATIC, 'editor.html'));
    if (req.method === 'GET' && p === '/preview') return sendFile(res, path.join(STATIC, 'shell.html'));
    if (req.method === 'GET' && p === '/_writer/render.js') return sendFile(res, path.join(HERE, 'render.js'));
    if (req.method === 'GET' && p === '/_writer/README.md') return sendFile(res, path.join(HERE, 'README.md'));
    if (req.method === 'GET' && p.startsWith('/_writer/')) { const f = under(STATIC, p.slice(9)); return f ? sendFile(res, f) : send(res, 403, 'no'); }
    if (req.method === 'GET' && p.startsWith('/vendor/')) { const v = VENDOR[p.slice(8)]; return v ? sendFile(res, path.join(NM, v)) : send(res, 404, 'not found'); }
    if (req.method === 'GET' && p.startsWith('/assets/')) {
      const f = under(path.join(SITE, 'assets'), p.slice(8));
      if (f) track(f, 'assets', p);
      return f ? sendFile(res, f) : send(res, 403, 'no');
    }
    if (req.method === 'GET' && p === '/favicon.ico') return sendFile(res, path.join(SITE, 'assets', 'img', 'favicon.svg'));

    if (p === '/api/drafts' && req.method === 'GET') return json(res, 200, await listDrafts());
    if (p === '/api/drafts' && req.method === 'POST') {
      const { title } = JSON.parse((await readBody(req, 1e4)).toString() || '{}');
      const base = (title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled';
      let slug = base, n = 2;
      // A new post may not take the name of a draft or of a post already on the site.
      const taken = s => fs.existsSync(draftFile(s)) || sitePosts().has(s);
      while (taken(slug)) slug = base + '-' + n++;
      fs.mkdirSync(DRAFTS, { recursive: true });
      fs.writeFileSync(draftFile(slug), newDraft(title || 'Untitled'));
      return json(res, 200, { slug });
    }
    // Drafts carry a content hash, so the editor can notice changes made on disk by something else
    // (another tool, an agent) and a save never silently overwrites a version the editor has not seen.
    let m = /^\/api\/drafts\/([^/]+)\/hash$/.exec(p);
    if (m && req.method === 'GET') {
      const slug = safeSlug(m[1]); if (!slug) return send(res, 400, 'bad slug');
      const file = draftFile(slug);
      editorSeen.set(slug, Date.now());
      return fs.existsSync(file) ? json(res, 200, { hash: draftHash(fs.readFileSync(file)), incoming: readQueue(slug).length }) : send(res, 404, 'no draft');
    }
    // Agent edits: queued while the author types, merged in by the editor after a minute without typing.
    m = /^\/api\/drafts\/([^/]+)\/incoming$/.exec(p);
    if (m) {
      const slug = safeSlug(m[1]); if (!slug) return send(res, 400, 'bad slug');
      if (!fs.existsSync(draftFile(slug))) return send(res, 404, 'no draft');
      if (req.method === 'GET') return json(res, 200, { items: readQueue(slug) });
      if (req.method === 'POST') {
        const b = JSON.parse((await readBody(req, 10e6)).toString() || '{}');
        if (typeof b.base !== 'string' || typeof b.text !== 'string') return send(res, 400, 'base and text are required');
        const q = readQueue(slug);
        const item = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), base: b.base, text: b.text, from: String(b.from || 'agent').slice(0, 60), t: Date.now() };
        q.push(item); writeQueue(slug, q);
        const open = editorOpen(slug);
        if (!open) applyQueueOnDisk(slug);
        const left = readQueue(slug);
        return json(res, 200, { id: item.id, editorOpen: open, queued: left.length, applied: !left.some(x => x.id === item.id), conflict: left.some(x => x.id === item.id && x.conflict) });
      }
      if (req.method === 'DELETE') {
        const ids = new Set((JSON.parse((await readBody(req, 1e5)).toString() || '{}').ids) || []);
        writeQueue(slug, readQueue(slug).filter(x => !ids.has(x.id)));
        return json(res, 200, { queued: readQueue(slug).length });
      }
    }
    m = /^\/api\/drafts\/([^/]+)$/.exec(p);
    if (m) {
      const slug = safeSlug(m[1]); if (!slug) return send(res, 400, 'bad slug');
      const file = draftFile(slug);
      if (req.method === 'GET') {
        if (!fs.existsSync(file)) return send(res, 404, 'no draft');
        const data = fs.readFileSync(file);
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-draft-hash': draftHash(data) });
        return res.end(data);
      }
      if (req.method === 'PUT') {
        const body = await readBody(req, 5e6), base = req.headers['x-base-hash'];
        // A save based on a loaded version never brings back a draft that was deleted in between.
        if (base && !fs.existsSync(file)) return send(res, 410, 'this draft was deleted');
        // Refuse a save based on an older version when the file changed on disk in between,
        // unless the new text already equals what is on disk.
        if (base && fs.existsSync(file)) {
          const disk = draftHash(fs.readFileSync(file));
          if (disk !== base && disk !== draftHash(body)) return json(res, 409, { error: 'changed on disk', hash: disk });
        }
        fs.writeFileSync(file, body);
        return json(res, 200, { saved: Date.now(), hash: draftHash(body) });
      }
      // Delete a post the site does not have. Its last text stays in the private history.
      if (req.method === 'DELETE') {
        if (!fs.existsSync(file)) return send(res, 404, 'no draft');
        try { return json(res, 200, await commitQueue(() => deleteDraft(slug))); }
        catch (err) { if (err.code === 409) return send(res, 409, err.message); throw err; }
      }
    }
    m = /^\/api\/(status|commit|history)\/([^/]+)(?:\/(version|snapshot))?$/.exec(p);
    if (m) {
      const slug = safeSlug(m[2]); if (!slug) return send(res, 400, 'bad slug');
      if (!fs.existsSync(draftFile(slug))) return send(res, 404, 'no draft');
      if (m[1] === 'status' && !m[3] && req.method === 'GET') return json(res, 200, await statusOf(slug));
      if (m[1] === 'commit' && !m[3] && req.method === 'POST') {
        const { message } = JSON.parse((await readBody(req, 1e4)).toString() || '{}');
        const title = splitFrontMatter(readDraft(slug)).meta.title || slug;
        return json(res, 200, await commitPost(slug, String(message || '').trim() || 'Update ' + title));
      }
      if (m[1] === 'history' && !m[3] && req.method === 'GET') return json(res, 200, await historyOf(slug));
      if (m[1] === 'history' && m[3] === 'version' && req.method === 'GET') {
        return send(res, 200, await versionOf(slug, url.searchParams.get('id') || '', url.searchParams.get('source')));
      }
      // Keep the current text as a version before an earlier one replaces it in the editor.
      if (m[1] === 'history' && m[3] === 'snapshot' && req.method === 'POST') return json(res, 200, { version: await histCommit(slug, 'Before restoring an earlier version') });
    }
    if (p === '/api/push' && req.method === 'POST') return json(res, 200, await commitQueue(push));
    if (p === '/api/sync' && req.method === 'POST') return json(res, 200, await commitQueue(push));
    if (p === '/api/pull' && req.method === 'POST') return json(res, 200, await commitQueue(pull));
    if (p === '/api/remote' && req.method === 'GET') return json(res, 200, await remoteStatus(url.searchParams.get('fetch') === '1'));
    m = /^\/api\/drafts\/([^/]+)\/(take-site|keep-mine)$/.exec(p);
    if (m && req.method === 'POST') {
      const slug = safeSlug(m[1]); if (!slug) return send(res, 400, 'bad slug');
      return json(res, 200, m[2] === 'take-site' ? await takeSite(slug) : keepMine(slug));
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
