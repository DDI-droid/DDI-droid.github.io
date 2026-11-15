# Writer

A local writing environment for the site. Markdown on the left; on the right, the site's real post
page (LessWrong's layout and stylesheet), re-rendered as you type. Commit puts a post on the site: it commits that post (and the images it uses) to
the site repository and pushes, so GitHub rebuilds the site.

## Run

Double-click `start.cmd`, or:

```
cd anshul-site/_writer
npm install        # once
node dev.cjs       # then open http://localhost:4400
```

Live reload is always on; there is no switch. Changes to the editor, renderer, preview shell, or
LessWrong styles reload the open writer automatically. The current draft is saved first, then reopened
at the same draft with its cursor and editor scroll restored. Changes to any loaded local asset
(images, video, styles, scripts or embedded documents) refresh the preview document, not the editor.
Unsaved preview text and scroll are preserved; media playback may restart. A shared revision stream
reconciles changes after reconnect, focus or network restoration, without per-image cache-busting.
See [HOT_RELOAD.md](HOT_RELOAD.md) for the diagnosis, design, limits and regression evidence.
Changes to `server.cjs` restart the local server automatically. Use `dev.cjs` (or
`start.cmd`), not `node server.cjs`, so server changes are supervised too.

- **Posts** live in `_writer/drafts/<slug>.md` and save as you type. Every post on the site is in the list: a Markdown
  post in `_posts` is imported the first time the writer lists it, and a draft with no edits of its own follows its
  post file when that changes outside the writer (a pull, or an edit made elsewhere). The list marks posts
  "not on the site" (never committed) and "changed" (edited since the last commit); the badge next to Commit says the same.
  A new post stays on this machine until its first Commit.
- **Images**: paste or drop one into the editor; it is saved to `assets/img/posts/<slug>/` and the figure is inserted.
- **Commit** waits for the current draft to save, shows what it will change and asks for a message, then writes the
  post into `_posts` and commits only that file and the site files the post uses (images, PDFs, stepped-figure frames);
  anything else in the working tree is left alone. Then it pushes. A writer post becomes
  `_posts/<date>-<slug>.html`, rendered with the same renderer as the preview (changing its date moves it); a Markdown
  post is written back as itself, so Jekyll renders it as before. Notes (`<!-- -->`) never reach the site. A failed
  save cancels the commit. If the push fails, the commit stays local and a **Push** button appears. Pushing sends every
  local commit the remote lacks, not only the writer's; the commit sheet says when there are others.
- **History** lists the versions of a post's source, newest first: one per commit, plus "Imported" and "Synced"
  versions, and for an old Markdown post its site commits from before the writer. Restore puts a version back in the
  editor after keeping the current text as a version; Commit then puts it on the site. The history is a separate git
  repository in `_writer/.history`; it and the drafts are git-ignored by the site, so sources and their notes never leave
  this machine.
- **Preview tab** opens `/preview?slug=<draft>` with the actual draft, including its title, date and reading time. It follows live edits from the editor and survives refreshing or closing the editor. A refreshed preview without an open editor shows the saved draft.
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

- `render.js`: the renderer, the same file in the browser preview and in Commit. It emits the HTML
  lesswrong.com emits (footnote, figure, table, spoiler and collapsible markup), so the site's copy of
  their stylesheet styles it identically.
- `static/shell.html`: the preview frame, a built post page with the article emptied. Regenerate it
  after changing `_layouts/post.liquid` or `default.liquid`: build with `build.sh`, then
  `node make_shell.cjs`.
- `server.cjs`: serves the editor, preview, site's `assets/`, and the draft, upload, status, commit, push and
  history endpoints on 127.0.0.1 only. Its built-in event stream watches the studio and preview files for changes.
- `dev.cjs`: keeps `server.cjs` running and restarts it if its code changes. This supervisor is the
  default launcher; the editor reconnects and reloads after a restart.

## Tests

`node tests/commit.cjs` and `node tests/commit_ui.cjs` (API and browser) run a disposable site whose remote is a
local bare repository: import, sync back, notes stripped, path-only commits with images, unrelated work left alone,
date moves, history and restore, a failed push followed by Push. They never touch the real site, drafts or GitHub.

With the writer running, `node tests/maintenance.cjs` runs assertion-based regression tests using fake
draft/status/commit APIs, never real posts: early iframe startup, repeated refreshes, a standalone preview tab
(including refresh and closed opener), unsaved live updates, slow and failed saves, draft switching,
image regeneration, deferred math initialization, and live reload preserving writing.
`node tests/supervisor.cjs` checks syntax-error and runtime-crash recovery in a temporary fixture.
Existing `tests/notes.cjs`, `tests/sidenotes.cjs`, and `tests/editor_layers.cjs` take an output directory
for screenshots and check notes, responsive footnotes, editor alignment, shortcuts and autosave.
`node tests/live_reload.cjs` runs in a disposable site with native file notifications disabled. It
checks real image/video replacement, nested media sources, styles/scripts/embedded documents,
missed events, offline recovery, startup races, atomic replacement and writing/undo preservation.
It never reads or changes real drafts or publishes posts.
Browser tests currently use installed Chrome on Windows; the maintenance test uses Playwright's
browser on other platforms.

`tests/recreate.cjs` converts LessWrong posts to this Markdown (`tests/lw_to_md.cjs`), renders them back,
and compares block by block with LessWrong's own HTML; `tests/inline_check.cjs` compares bold, italic,
links, code and scripts; `tests/visual.cjs` screenshots the live post next to the preview. On 18 Oct 2026,
five posts (math, footnotes, tables, collapsibles, spoilers, an embed) matched 574 of 574 blocks and
453 of 453 inline marks.
