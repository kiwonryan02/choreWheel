// Lack App service worker. It exists for installability and Web Push
// only. It deliberately caches nothing, so the app is always the latest build
// and state is always live.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// Payload (from the notify Edge Function): { title, body, tag, url }.
// iOS requires every push to show a notification, so we always show one.
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { body: event.data ? event.data.text() : '' }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Lack App', {
      body: payload.body || '',
      tag: payload.tag,
      renotify: Boolean(payload.tag), // a newer ping for the same chore still alerts
      icon: '/icons/icon-192.png',
      data: { url: payload.url || '/' },
    }),
  )
})

// Tapping a notification focuses the open app, or opens it.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const win of windows) {
        if (new URL(win.url).origin === self.location.origin && 'focus' in win) return win.focus()
      }
      return self.clients.openWindow(target)
    })(),
  )
})
