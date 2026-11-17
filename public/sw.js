const CACHE_NAME = 'afterframe-shell-v2'
const CORE_ASSETS = ['/', '/manifest.json', '/icon.svg']

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('message', event => {
  if (event.data?.type === 'CACHE_URLS' && Array.isArray(event.data.urls)) {
    event.waitUntil(
      caches.open(CACHE_NAME).then(async cache => {
        for (const url of event.data.urls) {
          try {
            const match = await cache.match(url)
            if (!match) {
              const response = await fetch(url)
              if (response.ok) await cache.put(url, response)
            }
          } catch {
            // Ignore offline warm-cache misses
          }
        }
      })
    )
  }
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Let API requests pass straight through to the app's own offline IndexedDB/localStorage layer.
  if (url.pathname.startsWith('/api/')) return

  // App shell navigations: network first, fallback to cached index.html when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE_NAME).then(cache => cache.put('/', copy))
          }
          return response
        })
        .catch(() => caches.match('/'))
    )
    return
  }

  // Static assets (/assets/*, icons, manifest): cache first, update from network on miss.
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached
      return fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy))
        }
        return response
      })
    })
  )
})
