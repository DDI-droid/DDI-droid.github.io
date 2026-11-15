/* Shared revision protocol for the editor and every preview document.
   SSE is a notification transport, not the source of truth: connect/reconnect,
   page restoration and focus reconcile the server's current state. */
(function () {
  'use strict';
  window.WriterLiveReload = {
    connect({ onTools = () => {}, onAssets = () => {} } = {}) {
      let current = window.__writerLiveState || null;
      let closed = false, pending = null;
      const live = new EventSource('/_writer/events');
      function accept(state) {
        if (closed || !navigator.onLine || !state || typeof state.instance !== 'string' || !Number.isInteger(state.revision)) return;
        if (current?.instance === state.instance && state.revision <= current.revision) return;
        const previous = current;
        current = state;
        if (!previous) return;
        if (previous.instance !== state.instance || previous.tools !== state.tools) onTools(state);
        else if (previous.assets !== state.assets) onAssets(state);
      }
      live.addEventListener('state', event => {
        try { accept(JSON.parse(event.data)); }
        catch (err) { console.error('[writer] invalid reload state:', err); }
      });
      function reconcile() {
        if (closed || pending) return;
        const instance = current?.instance;
        pending = fetch('/_writer/state', { cache: 'no-store' })
          .then(response => { if (!response.ok) throw new Error('reload state: ' + response.status); return response.json(); })
          .then(state => {
            // An old HTTP response must not undo a newer SSE server-restart snapshot.
            if (current?.instance === instance || current?.instance === state.instance) accept(state);
          })
          .catch(err => console.warn('[writer] reload reconciliation failed:', err.message))
          .finally(() => { pending = null; });
      }
      const visible = () => { if (!document.hidden) reconcile(); };
      window.addEventListener('focus', reconcile);
      window.addEventListener('pageshow', reconcile);
      window.addEventListener('online', reconcile);
      document.addEventListener('visibilitychange', visible);
      return {
        reconcile,
        close() {
          closed = true;
          live.close();
          window.removeEventListener('focus', reconcile);
          window.removeEventListener('pageshow', reconcile);
          window.removeEventListener('online', reconcile);
          document.removeEventListener('visibilitychange', visible);
        }
      };
    }
  };
})();
