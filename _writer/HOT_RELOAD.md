# Local writer reload design and verification

## What was observed

The user's open preview showed the older illustration (no gray input card and lowercase labels), while the PNG on disk and a newly opened browser showed the corrected image. The earlier verification checked a fresh page, not delivery to the existing page. That was insufficient.

There is no event trace from that historical browser tab, so the precise notification or connection that failed cannot be proved retrospectively. A missed-notification failure was reproduced separately. It is not evidence that the browser's HTTP cache was the cause: local responses already used `Cache-Control: no-store`.

## Defects in the old reload path

- Studio changes were checked against a fixed file list. Images had a separate recursive native directory watcher, with no reconciliation if a Windows/WSL write or atomic replacement produced no usable event.
- Image events contained no revision. A client could not compare its state with the server after a missed event.
- The preview invalidator selected only `img[src]`. A video outside the image directory was neither detected nor refreshed.
- Standalone previews depended on their own event stream; their BroadcastChannel handler discarded asset messages.
- An image's cache-busting URL could be discarded by the next article render.

The interim image-only polling/cache-busting attempt is removed, not extended with video-specific handlers. The general browser regression was run against that interim implementation and demonstrated an actual decoded video remaining at its old dimensions after replacement.

## Shared process

1. **Dependency registration:** the writer registers local `/assets/` resources when served, regardless of extension or folder. Loaded studio/vendor scripts and styles are registered too; core entry files are seeded at startup. This includes resources requested by CSS, media sources, and embedded local documents. It does not scan the entire repository or inspect secrets.
2. **Change reconciliation:** one monitor compares mtime, ctime, size and file identity. Two matching changed observations are required before announcement, coalescing short write bursts. Deletion and recreation remain tracked. There is no separate native image watcher.
3. **Revisioned state:** every change advances a server revision and either the tool or asset revision. `/_writer/state` exposes the current state and the last changed resource URLs. SSE sends that same state on connection, changes and heartbeat. Logs use `[writer:reload]` with the revision and changed URLs.
4. **Startup/reconnect:** editor and preview HTML carry the initial state used as their baseline. One shared client compares revisions, ignores older states, and reconciles again on focus, page restoration and network restoration. The current state is sent even if changes happened while the client was disconnected.
5. **Preview refresh:** any asset revision refreshes the preview document, not individual image/video DOM nodes. The browser recreates all resource consumers and loads local resources normally under `no-store`. This is document live reload, not media-specific hot-module replacement. The latest rendered draft and preview scroll are carried over, including unsaved editor broadcasts. Playback and other transient state inside preview media/widgets may restart.
6. **Writing safety:** asset changes do not navigate or replace the editor. Its text, cursor, scroll and native undo stack stay in place. Tool-code changes use the existing save-before-reload path. Offline previews defer reload rather than navigating into a browser error page. If preview state cannot be preserved, reload is paused and logged rather than discarding that state.

Only dependencies served by this local writer are monitored. Remote resources are not watched. Files deliberately rewritten while preserving *all* filesystem identity/change metadata cannot be distinguished by this stat-based development monitor; content hashing large videos on every scan is intentionally avoided. Exporting through a temporary file and atomic replacement remains preferable for long-running exporters; filesystem stability observations cannot prove another process has permanently finished writing.

## Verification

`node tests/live_reload.cjs` starts a disposable writer/site with native notifications disabled. It checks already-open embedded and standalone previews, not just a fresh visit:

- same-URL image overwrite, including restored mtime;
- actual decoded WebM video replacement, including an atomic rename and nested `<source>`;
- local stylesheet, script and embedded HTML updates through the same protocol;
- missed stream messages recovered by focus reconciliation;
- changes made offline recovered after reconnection;
- deletion/recreation, startup before a slow first render, and coalesced writes;
- no per-image URL rewriting;
- unsaved text, cursor selection, scroll and undo preserved, with zero editor navigation.

The existing `tests/maintenance.cjs` suite was also run against a disposable instance of the staged implementation: metadata, repeated refreshes, standalone tabs after closing the editor, unsaved broadcasts, slow/failed saves, publishing interception, safe draft switching, source reload preservation, math initialization and regenerated resources passed. No real post was published. `tests/supervisor.cjs` separately passed syntax-error and crash recovery.
