// Service-worker update detection. A new deploy installs in the background and waits;
// the UI shows "UPDATE READY - TAP TO RESTART" and calls applyUpdate() on tap.

let waiting: ServiceWorker | null = null;
let reloading = false;

export function updateReady(): boolean {
  return waiting !== null;
}

export function applyUpdate(): void {
  if (!waiting) return location.reload();
  reloading = true;
  waiting.postMessage('SKIP_WAITING');
  // controllerchange reloads; fall back in case it never fires
  setTimeout(() => location.reload(), 3000);
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) location.reload();
  });
  window.addEventListener('load', async () => {
    let reg: ServiceWorkerRegistration;
    try {
      reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    } catch {
      return; // offline support is optional
    }
    const track = (sw: ServiceWorker | null): void => {
      if (!sw) return;
      const check = (): void => {
        // 'installed' with an existing controller = an update waiting behind the running version
        if (sw.state === 'installed' && navigator.serviceWorker.controller) waiting = sw;
      };
      check();
      sw.addEventListener('statechange', check);
    };
    track(reg.waiting);
    track(reg.installing);
    reg.addEventListener('updatefound', () => track(reg.installing));
    const poll = (): void => void reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') poll();
    });
    setInterval(poll, 5 * 60 * 1000);
  });
}

/** Dev only: pretend an update is waiting, to preview the pill. */
export function __forceReadyForDev(): void {
  waiting = { postMessage: () => location.reload() } as unknown as ServiceWorker;
}
