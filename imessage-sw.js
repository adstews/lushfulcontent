// Service worker for the iMessage console PWA.
// Two jobs: (1) be installable, (2) show push notifications.
// We deliberately don't cache app shell — the console talks to live APIs and
// stale HTML would just confuse things.

const SW_VERSION = '1'

self.addEventListener('install', (e) => {
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch { payload = { body: event.data?.text() || '' } }

  const title = payload.title || 'New iMessage'
  const options = {
    body: payload.body || '',
    icon: '/imessage-icon-192.png',
    badge: '/imessage-icon-192.png',
    tag: payload.tag || 'imessage-default',
    data: payload.data || {},
    requireInteraction: false
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = '/imessage'
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of allClients) {
      if (c.url.endsWith('/imessage') || c.url.includes('/imessage')) {
        await c.focus()
        // Tell the page to open the relevant lead, if we have one.
        const leadId = event.notification.data?.leadId
        if (leadId) c.postMessage({ type: 'open-lead', leadId })
        return
      }
    }
    await self.clients.openWindow(target)
  })())
})
