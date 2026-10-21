// Turn one built post page (from a local Jekyll build) into the preview shell: the same page with
// the article emptied, the contents-rail script replaced by the preview bridge, and MathJax and
// the stepped-figure player loaded. Re-run after changing _layouts/post.liquid or default.liquid.
//
//   node make_shell.cjs [path/to/built/post/index.html]
const fs = require('fs');
const path = require('path');

const DEFAULT = '//wsl.localhost/Ubuntu-24.04/home/anshulthakur/site-build/out/blog/2026/plm-slides/index.html';
const src = process.argv[2] || DEFAULT;
let h = fs.readFileSync(src, 'utf8');

// 1. Empty the article: find <div id="markdown-content"> and its matching </div>.
const open = h.indexOf('<div id="markdown-content">');
if (open < 0) throw new Error('no #markdown-content in ' + src);
let depth = 0, i = open, close = -1;
const tag = /<\/?div\b[^>]*>/g;
tag.lastIndex = open;
for (let m; (m = tag.exec(h));) {
  depth += m[0][1] === '/' ? -1 : 1;
  if (depth === 0) { close = m.index; break; }
}
if (close < 0) throw new Error('unbalanced #markdown-content');
h = h.slice(0, open) + '<div id="markdown-content"></div>' + h.slice(close + '</div>'.length);

// 2. Replace the contents-rail script with the bridge (which rebuilds the rail on every render).
const rail = h.search(/<script>\s*\(\(\) => \{\s*\/\/ Contents rail/);
if (rail < 0) throw new Error('contents-rail script not found');
const railEnd = h.indexOf('</script>', rail) + '</script>'.length;
h = h.slice(0, rail) + '<script src="/_writer/bridge.js"></script>' + h.slice(railEnd);

// 3. Title and header fields get neutral placeholders; the bridge fills them.
h = h.replace(/<title>[\s\S]*?<\/title>/, '<title>Preview | Anshul Thakur</title>');
h = h.replace(/(<a class="PostsPageTitle-link" href=")[^"]*(">)[\s\S]*?(<\/a>)/, '$1#$2<span class="PostsPageTitle-lastWord">Untitled</span>$3');
h = h.replace(/(<div class="FixedPositionToC-tocTitle">)[\s\S]*?(<\/div>)/, '$1Untitled$2');

// 4. MathJax (as the site loads it) and the stepped-figure player.
const head = '<link rel="stylesheet" href="/_writer/build-player.css">\n' +
  '<script>window.MathJax={tex:{inlineMath:[["\\\\(","\\\\)"]],displayMath:[["\\\\[","\\\\]"]]},startup:{typeset:false}};</script>\n' +
  '<script defer src="https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.2/es5/tex-mml-chtml.js"></script>\n' +
  '<script src="/_writer/build-player.js"></script>\n';
h = h.replace('</head>', head + '</head>');

const out = path.join(__dirname, 'static', 'shell.html');
fs.writeFileSync(out, h);
console.log('shell written:', out, '(' + h.length + ' bytes) from', src);
