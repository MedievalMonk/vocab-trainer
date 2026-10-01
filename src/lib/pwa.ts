/**
 * Registers the service worker (production only: in dev it would cache stale code).
 * A new version installs quietly in the background and waits; `onUpdate` receives a function
 * that switches to it, so the UI can offer a reload at a safe moment.
 */
export function registerServiceWorker(onUpdate: (apply: () => void) => void) {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  // The very first install also changes the controller; only reload for real updates.
  const hadController = !!navigator.serviceWorker.controller
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloading) {
      reloading = true
      location.reload()
    }
  })

  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      const offerIfWaiting = () => {
        if (reg.waiting && navigator.serviceWorker.controller) onUpdate(() => reg.waiting?.postMessage('SKIP_WAITING'))
      }
      offerIfWaiting()
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') offerIfWaiting()
        })
      })
      // Look for a new version whenever the app comes back to the foreground.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {})
      })
    })
    .catch(() => {
      // Offline caching is a convenience; the app still works without it.
    })
}
