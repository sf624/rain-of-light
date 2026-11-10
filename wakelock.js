// Keep the screen awake while the page is showing (Screen Wake Lock API).
// The browser drops the lock when the page is hidden, so ask again on return.
export function keepAwake() {
  if (!('wakeLock' in navigator)) return;
  let lock = null;
  let pending = false;
  async function acquire() {
    if (lock || pending || document.visibilityState !== 'visible') return;
    pending = true;
    try {
      const l = await navigator.wakeLock.request('screen');
      lock = l;
      l.addEventListener('release', () => { if (lock === l) lock = null; });
    } catch {
      // Battery saver, no permission, insecure context: carry on without.
    }
    pending = false;
  }
  document.addEventListener('visibilitychange', acquire);
  acquire();
}
