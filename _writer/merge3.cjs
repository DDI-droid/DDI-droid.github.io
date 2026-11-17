// Line-based three-way merge, shared by the server (agent edit queue). static/editor.js holds the same code.
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
module.exports = { merge3, diffHunks };
