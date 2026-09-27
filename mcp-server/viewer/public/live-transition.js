// Run synchronously in the page head, before a restored reader can briefly show
// its underlying scene. Only this tab's pending live-reader refresh opts in.
(() => {
  try {
    const key = `meaning-model-live:${location.pathname}:${new URLSearchParams(location.search).get('data') ?? 'model'}`;
    const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (!saved?.reader?.open || !Number.isFinite(saved.savedAt) || Date.now() - saved.savedAt >= 300_000) return;
    const root = document.documentElement;
    root.setAttribute('data-live-reader-refresh', '');
    const style = document.createElement('style');
    style.textContent = 'html[data-live-reader-refresh]::before{content:"Updating saved revision…";position:fixed;inset:0;z-index:2147483647;background:#0b1017;color:#b8c1ce;display:grid;place-items:center;font:14px system-ui,sans-serif}';
    document.head.append(style);
    // A failed module/browser cannot strand the page behind the transition.
    setTimeout(() => root.removeAttribute('data-live-reader-refresh'), 20_000);
    addEventListener('keydown', (event) => { if (event.key === 'Escape') root.removeAttribute('data-live-reader-refresh'); });
  } catch { /* Disabled storage leaves ordinary snapshot startup unchanged. */ }
})();
