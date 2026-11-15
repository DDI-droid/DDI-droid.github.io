// Commit, sync and history checks in a disposable site with a local bare repository as its remote.
// Never touches the real site, drafts, history or GitHub. Usage: node tests/commit.cjs [server file]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const serverFile = path.resolve(process.argv[2] || path.join(__dirname, '..', 'server.cjs'));
const PORT = 4400 + 30 + (process.pid % 50);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'writer-commit-'));
const site = path.join(tmp, 'site'), remote = path.join(tmp, 'remote.git'), drafts = path.join(tmp, 'drafts'), history = path.join(tmp, 'history');
const sh = (args, cwd = site) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (rel, text) => { const f = path.join(site, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const read = rel => fs.readFileSync(path.join(site, rel), 'utf8').replace(/\r\n/g, '\n');
const api = async (p, opts = {}) => {
  const r = await fetch('http://127.0.0.1:' + PORT + p, opts);
  const text = await r.text();
  if (!r.ok) throw new Error(p + ' -> ' + r.status + ' ' + text);
  return /json/.test(r.headers.get('content-type') || '') ? JSON.parse(text) : text;
};
const put = (slug, text) => api('/api/drafts/' + slug, { method: 'PUT', body: text });
const commit = (slug, message) => api('/api/commit/' + slug, { method: 'POST', body: JSON.stringify({ message }) });

(async () => {
  sh(['init', '--quiet', '--bare', remote], tmp);
  fs.mkdirSync(site);
  sh(['init', '--quiet', '-b', 'main']);
  sh(['config', 'user.name', 'Test Writer']); sh(['config', 'user.email', 'test@example.invalid']);
  write('_config.yml', 'title: test\nurl: https://example.invalid # host\n');
  write('.gitignore', 'assets/libs/\n');
  write('_posts/2025-01-01-old-post.md', '---\nlayout: post\ntitle: Old post\ndate: 2025-01-01 12:00:00\n---\n\nFirst paragraph.\n\n<!-- placeholder comment -->\n\n![a](/assets/img/posts/old-post/a.png)\n');
  write('assets/img/posts/old-post/a.png', 'png-a');
  write('_pages/projects.md', '---\nlayout: page\ntitle: projects\npermalink: /projects/\n---\n\n## Research\n\n- One project.\n');
  write('_pages/cv.md', '---\nlayout: page\npermalink: /academics/\ntitle: academics\n---\n\n## School\n');
  write('_pages/about.md', '---\nlayout: about\npermalink: /\ntitle: about\n---\n\nNot editable from the writer.\n');
  sh(['add', '-A']); sh(['commit', '--quiet', '-m', 'start']);
  sh(['remote', 'add', 'origin', remote]); sh(['push', '--quiet', '-u', 'origin', 'main']);
  // Unrelated work in the site that a commit must leave alone: an untracked file, an edit, a staged edit.
  write('scratch.txt', 'not mine');
  write('_config.yml', 'title: test edited\nurl: https://example.invalid # host\n');
  write('notes.txt', 'staged'); sh(['add', 'notes.txt']);

  const server = spawn(process.execPath, [serverFile], { env: { ...process.env, PORT: String(PORT), WRITER_SITE: site, WRITER_DRAFTS: drafts, WRITER_HISTORY: history }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  try {
    for (let i = 0; i < 50; i++) { try { await api('/api/drafts'); break; } catch { await new Promise(r => setTimeout(r, 200)); } }

    // 1. A Markdown post on the site is imported; its own HTML comment does not count as a change.
    let list = await api('/api/drafts');
    const old = list.find(d => d.slug === 'old-post');
    assert.ok(old, 'old post imported'); assert.equal(old.state, 'live');
    assert.match(fs.readFileSync(path.join(drafts, 'old-post.md'), 'utf8'), /placeholder comment/);
    assert.equal((await api('/api/history/old-post')).length >= 1, true);
    assert.equal((await commit('old-post', 'nothing')).commit, null, 'a live post makes no commit');

    // 2. Editing it: the committed file has the edit but not the note; only its files are committed; it is pushed.
    const src = fs.readFileSync(path.join(drafts, 'old-post.md'), 'utf8');
    await put('old-post', src.replace('First paragraph.', 'First paragraph, edited.\n<!-- secret note -->\nSecond line.'));
    let st = await api('/api/status/old-post');
    assert.equal(st.state, 'changed'); assert.deepEqual(st.files.map(f => f.path), ['_posts/2025-01-01-old-post.md']);
    let res = await commit('old-post', 'Edit the old post');
    assert.ok(res.commit && res.pushed, 'committed and pushed: ' + JSON.stringify(res));
    assert.equal(res.site, 'https://example.invalid/blog/2025/old-post/');
    const committed = read('_posts/2025-01-01-old-post.md');
    assert.match(committed, /First paragraph, edited\.\nSecond line\./); assert.doesNotMatch(committed, /secret note|placeholder comment/);
    assert.deepEqual(sh(['show', '--name-only', '--format=', 'HEAD']).trim().split('\n'), ['_posts/2025-01-01-old-post.md']);
    assert.equal(sh(['log', '-1', '--format=%s']).trim(), 'Edit the old post');
    assert.equal(sh(['rev-parse', 'HEAD']), sh(['rev-parse', 'main'], remote), 'remote has the commit');
    assert.match(sh(['status', '--porcelain']), /\?\? scratch\.txt/); assert.match(sh(['status', '--porcelain']), / M _config\.yml/);
    assert.match(sh(['status', '--porcelain']), /A  notes\.txt/, 'staged unrelated file stays staged, uncommitted');
    assert.match(fs.readFileSync(path.join(drafts, 'old-post.md'), 'utf8'), /secret note/, 'the source keeps its note');
    assert.equal((await api('/api/status/old-post')).state, 'live');

    // 3. A new post: not on the site until its first commit, then a rendered .html with its image.
    const { slug } = await api('/api/drafts', { method: 'POST', body: JSON.stringify({ title: 'Fresh Post' }) });
    assert.equal(slug, 'fresh-post');
    assert.equal((await api('/api/drafts')).find(d => d.slug === slug).state, 'new');
    assert.equal(fs.readdirSync(path.join(site, '_posts')).some(f => f.includes('fresh-post')), false, 'nothing written before Commit');
    write('assets/img/posts/fresh-post/b.png', 'png-b'); write('assets/libs/x.js', 'ignored');
    const fresh = '---\ntitle: Fresh Post\ndate: 2025-02-02\n---\n\nHello.\n\n![b](/assets/img/posts/fresh-post/b.png "")\n\n<script src="/assets/libs/x.js"></script>\n';
    await put(slug, fresh);
    st = await api('/api/status/' + slug);
    assert.equal(st.state, 'new'); assert.deepEqual(st.files.map(f => f.path).sort(), ['_posts/2025-02-02-fresh-post.html', 'assets/img/posts/fresh-post/b.png']);
    res = await commit(slug, 'Add Fresh Post');
    assert.ok(res.commit && res.pushed);
    assert.deepEqual(sh(['show', '--name-only', '--format=', 'HEAD']).trim().split('\n').sort(), ['_posts/2025-02-02-fresh-post.html', 'assets/img/posts/fresh-post/b.png']);
    assert.match(read('_posts/2025-02-02-fresh-post.html'), /^---\nlayout: post\ntitle: "Fresh Post"\ndate: 2025-02-02 00:00:00 \+0000/);
    assert.equal((await commit(slug, 'again')).commit, null, 'recommitting an unchanged post makes no commit');

    // 4. Changing its date moves the post: the old file is removed in the same commit.
    await put(slug, fresh.replace('2025-02-02', '2025-03-03'));
    assert.equal((await api('/api/status/' + slug)).state, 'changed');
    res = await commit(slug, 'Move Fresh Post');
    assert.deepEqual(sh(['show', '--name-status', '--no-renames', '--format=', 'HEAD']).trim().split('\n').sort(),
      ['A\t_posts/2025-03-03-fresh-post.html', 'D\t_posts/2025-02-02-fresh-post.html'].sort());

    // 5. History: versions with their site commits; an earlier version can be read back; a snapshot keeps the current text.
    let hist = await api('/api/history/' + slug);
    assert.equal(hist.length, 2); assert.equal(hist[0].message, 'Move Fresh Post'); assert.ok(hist[0].site);
    assert.match(await api('/api/history/' + slug + '/version?id=' + hist[1].id), /2025-02-02/);
    await put(slug, fresh.replace('Hello.', 'Hello, unsaved idea.'));
    await api('/api/history/' + slug + '/snapshot', { method: 'POST' });
    hist = await api('/api/history/' + slug);
    assert.equal(hist[0].message, 'Before restoring an earlier version'); assert.equal(hist[0].site, null);
    const oldHist = await api('/api/history/old-post');
    assert.ok(oldHist.some(h => h.source === 'site' && h.message === 'start'), 'Markdown post lists its commits from before the writer');
    assert.match(await api('/api/history/old-post/version?source=site&id=' + oldHist.find(h => h.source === 'site').id), /First paragraph\./);

    // 6. Sync back: an untouched draft follows its post file when that changes outside the writer...
    const now = read('_posts/2025-01-01-old-post.md');
    write('_posts/2025-01-01-old-post.md', now.replace('Second line.', 'Second line, changed on the site.'));
    await api('/api/drafts');
    assert.match(fs.readFileSync(path.join(drafts, 'old-post.md'), 'utf8'), /changed on the site/);
    assert.equal((await api('/api/history/old-post'))[0].message, 'Synced from _posts/2025-01-01-old-post.md');
    // ...but a draft with edits of its own is left alone.
    await put('old-post', fs.readFileSync(path.join(drafts, 'old-post.md'), 'utf8') + '\nMy own edit.\n');
    write('_posts/2025-01-01-old-post.md', now + '\nAnother outside change.\n');
    await api('/api/drafts');
    assert.match(fs.readFileSync(path.join(drafts, 'old-post.md'), 'utf8'), /My own edit/);

    // 7. A failed push leaves the commit local and says so; Push sends it later.
    fs.renameSync(remote, remote + '.away');
    await put(slug, fresh.replace('2025-02-02', '2025-03-03').replace('Hello.', 'Hello again.'));
    res = await commit(slug, 'Offline edit');
    assert.ok(res.commit); assert.equal(res.pushed, false); assert.ok(res.pushError); assert.equal(res.ahead, 1);
    assert.equal((await api('/api/status/' + slug)).ahead, 1);
    fs.renameSync(remote + '.away', remote);
    res = await api('/api/push', { method: 'POST' });
    assert.equal(res.pushed, true); assert.equal(res.ahead, 0);
    assert.equal(sh(['rev-parse', 'HEAD']), sh(['rev-parse', 'main'], remote));

    // 8. A new post cannot take the name of a post already on the site.
    assert.equal((await api('/api/drafts', { method: 'POST', body: JSON.stringify({ title: 'Old post' }) })).slug, 'old-post-2');

    // 9. Site pages: projects and academics come in as page drafts; Commit writes them back to _pages.
    list = await api('/api/drafts');
    const proj = list.find(d => d.slug === 'page-projects'), acad = list.find(d => d.slug === 'page-academics');
    assert.ok(proj && acad, 'projects and academics imported: ' + list.map(d => d.slug).join(','));
    assert.equal(proj.title, 'Page: projects'); assert.equal(proj.state, 'live');
    assert.equal(list.some(d => d.slug === 'page-about' || d.slug === 'page-'), false, 'other pages stay out');
    const page = fs.readFileSync(path.join(drafts, 'page-projects.md'), 'utf8');
    await put('page-projects', page.replace('- One project.', '- One project.\n- A second project. <!-- private -->'));
    st = await api('/api/status/page-projects');
    assert.equal(st.state, 'changed'); assert.equal(st.url, '/projects/'); assert.deepEqual(st.files.map(f => f.path), ['_pages/projects.md']);
    res = await commit('page-projects', 'Add a project');
    assert.ok(res.commit && res.pushed);
    assert.match(read('_pages/projects.md'), /- A second project\.\n/); assert.doesNotMatch(read('_pages/projects.md'), /private/);
    assert.deepEqual(sh(['show', '--name-only', '--format=', 'HEAD']).trim().split('\n'), ['_pages/projects.md']);
    assert.equal((await api('/api/status/page-academics')).url, '/academics/');

    // 10. Edited here and on the site: the list flags it; Keep mine holds until the site file changes again;
    // Use the site version replaces the draft and keeps the draft's text in history.
    const conflict = async s => (await api('/api/drafts')).find(d => d.slug === s).conflict;
    assert.equal(await conflict('old-post'), true, 'own edit + outside change is a conflict');
    await api('/api/drafts/old-post/keep-mine', { method: 'POST' });
    assert.equal(await conflict('old-post'), false);
    assert.match(fs.readFileSync(path.join(drafts, 'old-post.md'), 'utf8'), /My own edit/);
    write('_posts/2025-01-01-old-post.md', now + '\nA third outside change.\n');
    assert.equal(await conflict('old-post'), true, 'a newer site version asks again');
    await api('/api/drafts/old-post/take-site', { method: 'POST' });
    assert.equal(await conflict('old-post'), false);
    assert.equal(fs.readFileSync(path.join(drafts, 'old-post.md'), 'utf8'), read('_posts/2025-01-01-old-post.md'));
    hist = await api('/api/history/old-post');
    assert.match(hist[0].message, /^Took the site version/); assert.match(hist[1].message, /^Before taking the site version/);
    assert.match(await api('/api/history/old-post/version?id=' + hist[1].id), /My own edit/, 'the replaced text is kept');
    sh(['checkout', '--', '_posts/2025-01-01-old-post.md']);
    assert.equal((await api('/api/drafts')).find(d => d.slug === 'old-post').state, 'live', 'an untouched draft follows the site again');

    // 11. GitHub ahead: the GitHub check lists the commit; Sync fast-forwards without touching unrelated work;
    // drafts follow; a post edited both here and on GitHub is flagged.
    const other = path.join(tmp, 'other');
    sh(['clone', '--quiet', '-b', 'main', remote, other], tmp);
    sh(['config', 'user.name', 'Elsewhere'], other); sh(['config', 'user.email', 'else@example.invalid'], other);
    const otherWrite = (rel, text) => { const f = path.join(other, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
    const otherCommit = msg => { sh(['add', '-A'], other); sh(['commit', '--quiet', '-m', msg], other); sh(['push', '--quiet', 'origin', 'main'], other); };
    otherWrite('_data/extra.yml', 'a: 1\n');
    otherWrite('_pages/cv.md', fs.readFileSync(path.join(other, '_pages/cv.md'), 'utf8') + '\n## Edited on GitHub\n');
    otherWrite('_posts/2025-01-01-old-post.md', fs.readFileSync(path.join(other, '_posts/2025-01-01-old-post.md'), 'utf8').replace('Second line.', 'Second line, from GitHub.'));
    otherCommit('Edit on GitHub');
    await put('old-post', fs.readFileSync(path.join(drafts, 'old-post.md'), 'utf8') + '\nA local thought.\n');
    let rs = await api('/api/remote?fetch=1');
    assert.equal(rs.behind, 1); assert.equal(rs.ahead, 0); assert.equal(rs.incoming[0].subject, 'Edit on GitHub'); assert.deepEqual(rs.blocked, []);
    res = await api('/api/sync', { method: 'POST' });
    assert.equal(res.pushed, true, JSON.stringify(res)); assert.equal(res.brought, 1); assert.equal(res.sent, 0); assert.equal(res.behind, 0);
    assert.equal(sh(['rev-parse', 'HEAD']), sh(['rev-parse', 'main'], remote));
    assert.equal(read('_data/extra.yml'), 'a: 1\n');
    assert.match(sh(['status', '--porcelain']), /\?\? scratch\.txt/); assert.match(sh(['status', '--porcelain']), / M _config\.yml/);
    assert.match(sh(['status', '--porcelain']), /A  notes\.txt/);
    assert.match(fs.readFileSync(path.join(drafts, 'page-academics.md'), 'utf8'), /Edited on GitHub/, 'an untouched draft follows the pull');
    assert.equal(await conflict('old-post'), true, 'edited here and on GitHub');
    assert.match(fs.readFileSync(path.join(drafts, 'old-post.md'), 'utf8'), /A local thought/);

    // 12. Both sides ahead: a commit here pulls first. Staged unrelated work stops the merge (nothing pushed, the
    // commit stays here); once it is unstaged, Sync merges and pushes, and GitHub has both sides.
    otherWrite('_data/extra.yml', 'a: 2\n'); otherCommit('Second GitHub edit');
    await put(slug, fresh.replace('2025-02-02', '2025-03-03').replace('Hello.', 'Hello from here.'));
    res = await commit(slug, 'Local edit');
    assert.ok(res.commit); assert.equal(res.pushed, false); assert.match(res.pushError, /pulling from GitHub first failed/);
    assert.equal(sh(['rev-parse', 'main'], remote), sh(['rev-parse', 'main'], other), 'nothing reached GitHub');
    assert.equal(res.ahead, 1); assert.equal(res.behind, 1);
    sh(['reset', '--quiet', '--', 'notes.txt']);
    res = await api('/api/sync', { method: 'POST' });
    assert.equal(res.pushed, true, JSON.stringify(res)); assert.equal(res.brought, 1); assert.equal(res.sent, 2);
    assert.equal(sh(['rev-parse', 'HEAD']), sh(['rev-parse', 'main'], remote));
    assert.equal(sh(['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(' ').length, 3, 'a merge commit');
    assert.equal(sh(['show', 'main:_data/extra.yml'], remote), 'a: 2\n');
    assert.match(sh(['show', 'main:_posts/2025-03-03-fresh-post.html'], remote), /Hello from here/);
    assert.match(sh(['status', '--porcelain']), /\?\? notes\.txt/); assert.match(sh(['status', '--porcelain']), / M _config\.yml/);

    // 13. A GitHub change to a file with uncommitted changes here: the check names it; Sync refuses and changes nothing.
    sh(['pull', '--quiet', 'origin', 'main'], other);
    otherWrite('_config.yml', 'title: from GitHub\nurl: https://example.invalid # host\n'); otherCommit('Config on GitHub');
    rs = await api('/api/remote?fetch=1');
    assert.equal(rs.behind, 1); assert.deepEqual(rs.blocked, ['_config.yml']);
    const head = sh(['rev-parse', 'HEAD']);
    res = await api('/api/sync', { method: 'POST' });
    assert.equal(res.pushed, false); assert.match(res.pushError, /_config\.yml/);
    assert.equal(sh(['rev-parse', 'HEAD']), head); assert.match(read('_config.yml'), /title: test edited/);
    console.log('PASS: import, comment-only posts stay live, edit + note stripping + path-only commit + push, unrelated work untouched, new post with image (ignored asset skipped), unchanged recommit, date move, history + versions + snapshot + pre-writer commits, sync back, own edits kept, failed push then Push, name clash, projects and academics pages edited and committed to _pages, conflicts kept or replaced, GitHub check, pull-then-push fast-forward, diverged merge, staged and dirty files refused.');
  } catch (err) {
    console.error('FAIL:', err.stack || err); console.error(log); process.exitCode = 1;
  } finally {
    server.kill();
    if (!process.exitCode) fs.rmSync(tmp, { recursive: true, force: true }); else console.error('kept', tmp);
  }
})();
