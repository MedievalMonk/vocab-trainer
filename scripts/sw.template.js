/* Service worker template. vite.config.ts fills in the version and the file list at build time.
   Strategy: the whole app is cached on install and served from cache, so it opens offline.
   A new version installs in the background and WAITS: the page asks the user before switching,
   so an update never replaces the app in the middle of a study session. */
const VERSION = '__VERSION__'
const CACHE = 'vocab-' + VERSION
const PRECACHE = __PRECACHE__

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('vocab-') && key !== CACHE) await caches.delete(key)
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  if (new URL(req.url).origin !== self.location.origin) return
  if (req.mode === 'navigate') {
    event.respondWith(caches.match('./index.html').then((hit) => hit || fetch(req)))
    return
  }
  // ignoreVary: module scripts send an Origin header the stored copies were fetched without,
  // and a Vary mismatch would make the lookup miss.
  event.respondWith(caches.match(req, { ignoreSearch: true, ignoreVary: true }).then((hit) => hit || fetch(req)))
})
