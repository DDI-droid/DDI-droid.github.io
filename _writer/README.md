# Writer

A local writing environment for the site. Markdown on the left; on the right, the site's real post
page (LessWrong's layout and stylesheet), re-rendered as you type. Nothing leaves the machine until a
push.

## Run

Double-click `start.cmd`, or:

```
cd anshul-site/_writer
npm install        # once
node server.cjs    # then open http://localhost:4400
```

- **Drafts** live in `_writer/drafts/<slug>.md` and save as you type.
- **Images**: paste or drop one into the editor; it is saved to `assets/img/posts/<slug>/` and the figure is inserted.
- **Publish** writes `_posts/<date>-<slug>.html`, rendered with the same renderer as the preview. It does not commit or push.
- **Double-click** a paragraph in the preview to jump to its source. "Sync scroll" keeps the preview at the part you are editing.
- **Grammarly** works in the editor: the source is a real text box (which Grammarly checks) with transparent text, over a syntax-highlighted copy of the same text. Token styles may change colour, weight or slant but never size, or the two layers stop lining up.
- **Notes**: `<!-- ... -->` is a note to yourself, shown greyed in the editor and dropped from the preview and the published post (Grammarly still reads it as text). Ctrl+/ turns the line or selection into a note, or back.
- **Footnotes** show as lesswrong.com shows them: sidenotes in the right column at 1280 px and wider, a hover card below that, a dialog on phones (`assets/js/lw-footnotes.js`, a port of their code; check with `node tests/sidenotes.cjs <out_dir>`). "Desktop width" lays the preview out at 1300 px and scales it to the pane, so the sidenotes show; untick it for full-size text.

## Syntax

Front matter at the top: `title`, `description`, `date` (YYYY-MM-DD), `tags`, `categories`, optional
`og_image`, and `smartquotes: false` to keep straight quotes.

| Write | Get |
|---|---|
| `## Section`, `### Sub`, `#### Sub-sub` | headings (`##` is LessWrong's section heading) |
| `**bold**` `*italic*` `~~struck~~` `` `code` `` | inline styles |
| `[text](url)` | link |
| `- item`, `1. item` (indent 2 spaces to nest) | lists |
| `> quote` | block quote |
| `$x^2$` | inline math (a `$` followed by a space or digit stays a dollar sign) |
| `$$` on its own line, TeX, `$$` | display math |
| `text[^1]` and `[^1]: the note` | footnote (a sidenote on wide screens); indent 4 spaces for further paragraphs |
| `<!-- note -->` | a note to yourself; never rendered or published (Ctrl+/) |
| `![alt](src "caption")` | figure with caption; add `{width=60%}` right after to resize |
| GitHub-style table | table; an all-empty header row means "no header" |
| HTML `<figure class="table"><table>…</table></figure>` | a table with styles, merged cells or row headers; `$math$` and `[^n]` still work in its cells |
| ```` ```python ```` … ```` ``` ```` | code block |
| `>! hidden` (one or more lines) | spoiler, revealed on hover |
| `+++ Title` … `+++` | collapsible section |
| `::build /assets/img/posts/x/name 5 "alt"` | stepped figure from `name-1.png` … `name-5.png` |
| a YouTube link alone on a line | embedded video |
| `---` | horizontal rule |
| any HTML | passes through |

Shortcuts: Ctrl+B bold, Ctrl+I italic, Ctrl+K link, Ctrl+S save now.

## How it fits together

- `render.js`: the renderer, the same file in the browser preview and in Publish. It emits the HTML
  lesswrong.com emits (footnote, figure, table, spoiler and collapsible markup), so the site's copy of
  their stylesheet styles it identically.
- `static/shell.html`: the preview frame, a built post page with the article emptied. Regenerate it
  after changing `_layouts/post.liquid` or `default.liquid`: build with `build.sh`, then
  `node make_shell.cjs`.
- `server.cjs`: serves the editor, the preview, the site's `assets/`, and the draft, upload and publish
  endpoints, on 127.0.0.1 only.

## Tests

`tests/recreate.cjs` converts LessWrong posts to this Markdown (`tests/lw_to_md.cjs`), renders them back,
and compares block by block with LessWrong's own HTML; `tests/inline_check.cjs` compares bold, italic,
links, code and scripts; `tests/visual.cjs` screenshots the live post next to the preview. On 18 Oct 2026,
five posts (math, footnotes, tables, collapsibles, spoilers, an embed) matched 574 of 574 blocks and
453 of 453 inline marks.
