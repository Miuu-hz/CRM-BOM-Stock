const CACHE_NAME = 'phopy-erp-v1'
const PRECACHE = ['/', '/sounds/order-voice.m4a', '/icons/icon.svg']

// ── Install: pre-cache critical assets ──────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  )
})

// ── Activate: remove old caches ──────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

// ── Fetch: network-first; cache fallback for non-API requests ────────────────
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  if (new URL(event.request.url).pathname.startsWith('/api')) return

  event.respondWith(
    fetch(event.request)
      .then(res => {
        const clone = res.clone()
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone))
        return res
      })
      .catch(() => caches.match(event.request))
  )
})

// ── Push: handle server-sent push notifications (VAPID) ─────────────────────
self.addEventListener('push', (event) => {
  let payload = { title: 'KDS · ออร์เดอร์ใหม่', body: 'มีออร์เดอร์รอดำเนินการในครัว' }
  try { payload = event.data?.json() ?? payload } catch {}

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon.svg',
      badge: '/icons/icon.svg',
      tag: 'kds-push',
      requireInteraction: false,
    })
  )
})

// ── Notification click: focus or open KDS tab ────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(all => {
      const existing = all.find(w => w.url.includes('/kds'))
      if (existing) return existing.focus()
      return clients.openWindow('/kds')
    })
  )
})
