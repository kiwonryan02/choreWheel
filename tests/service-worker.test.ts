import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

// Loads public/sw.js against a fake service worker scope so its push and
// click handlers can be exercised without a browser.
function loadServiceWorker(openWindows: { url: string; focus: () => unknown }[] = []) {
  const listeners: Record<string, (event: any) => void> = {}
  const shown: { title: string; options: Record<string, any> }[] = []
  const opened: string[] = []
  const scope = {
    addEventListener: (type: string, fn: (event: any) => void) => (listeners[type] = fn),
    skipWaiting: () => Promise.resolve(),
    clients: {
      claim: () => Promise.resolve(),
      matchAll: async () => openWindows,
      openWindow: async (url: string) => void opened.push(url),
    },
    registration: {
      showNotification: async (title: string, options: Record<string, any>) => void shown.push({ title, options }),
    },
    location: { origin: 'https://app.example' },
  }
  vm.runInNewContext(readFileSync(join(import.meta.dir, '../public/sw.js'), 'utf8'), { self: scope, URL })

  // Fires an event and waits for whatever it handed to waitUntil.
  async function fire(type: string, event: Record<string, any>) {
    const pending: Promise<unknown>[] = []
    listeners[type]({ ...event, waitUntil: (p: Promise<unknown>) => pending.push(p) })
    await Promise.all(pending)
  }
  return { fire, shown, opened }
}

const pushEvent = (payload: unknown) => ({ data: { json: () => payload, text: () => String(payload) } })

describe('push', () => {
  test('shows the notification the server sent', async () => {
    const sw = loadServiceWorker()
    await sw.fire('push', pushEvent({ title: 'Dishes done', body: 'Sam finished the dishes. Next up: Alex.', tag: 'chore-dishes', url: '/' }))
    expect(sw.shown).toHaveLength(1)
    expect(sw.shown[0].title).toBe('Dishes done')
    expect(sw.shown[0].options).toMatchObject({
      body: 'Sam finished the dishes. Next up: Alex.',
      tag: 'chore-dishes',
      renotify: true,
      icon: '/icons/icon-192.png',
      data: { url: '/' },
    })
  })

  test('always shows something (iOS requires it), even with no or broken data', async () => {
    const sw = loadServiceWorker()
    await sw.fire('push', {})
    await sw.fire('push', { data: { json: () => { throw new Error('bad json') }, text: () => 'plain text body' } })
    expect(sw.shown).toHaveLength(2)
    expect(sw.shown[0].title).toBe('Lack App')
    expect(sw.shown[1].options.body).toBe('plain text body')
  })

  test('does not renotify when there is no tag', async () => {
    const sw = loadServiceWorker()
    await sw.fire('push', pushEvent({ title: 't', body: 'b' }))
    expect(sw.shown[0].options.renotify).toBe(false)
  })
})

describe('notification click', () => {
  test('focuses the app if it is already open', async () => {
    let focused = 0
    const sw = loadServiceWorker([{ url: 'https://app.example/', focus: () => void focused++ }])
    let closed = false
    await sw.fire('notificationclick', { notification: { close: () => (closed = true), data: { url: '/' } } })
    expect(closed).toBe(true)
    expect(focused).toBe(1)
    expect(sw.opened).toEqual([])
  })

  test('opens the app if it is not open (ignoring windows on other origins)', async () => {
    const sw = loadServiceWorker([{ url: 'https://elsewhere.example/', focus: () => { throw new Error('wrong window') } }])
    await sw.fire('notificationclick', { notification: { close: () => {}, data: { url: '/' } } })
    expect(sw.opened).toEqual(['https://app.example/'])
  })
})
