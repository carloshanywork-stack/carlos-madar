// Reload only once per build and only while online. Durable queues are untouched.
export function installChunkRecovery(target) {
  target.addEventListener('vite:preloadError', (event) => {
    if (target.navigator.onLine === false) return;
    const key = `madar-chunk-recovery:${__MADAR_BUILD_VERSION__}`;
    try {
      if (target.sessionStorage.getItem(key)) return;
      target.sessionStorage.setItem(key, '1');
    } catch { return; } // No reload loop when browser storage is unavailable.
    event.preventDefault();
    target.location.reload();
  });
}
