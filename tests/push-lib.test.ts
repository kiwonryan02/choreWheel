import { afterEach, describe, expect, test } from 'bun:test'
import { createECDH } from 'node:crypto'
import { isIos, urlBase64ToUint8Array } from '../src/lib/push'

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
function fakeNavigator(userAgent: string, maxTouchPoints = 0) {
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent, maxTouchPoints }, configurable: true })
}
afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
})

describe('urlBase64ToUint8Array', () => {
  test('decodes unpadded base64url, including the - and _ characters', () => {
    expect([...urlBase64ToUint8Array('AQID')]).toEqual([1, 2, 3])
    expect([...urlBase64ToUint8Array('-_8')]).toEqual([251, 255])
  })

  test('decodes a real VAPID public key to the 65-byte uncompressed P-256 point', () => {
    const ecdh = createECDH('prime256v1')
    ecdh.generateKeys()
    const bytes = urlBase64ToUint8Array(ecdh.getPublicKey().toString('base64url'))
    expect(bytes).toHaveLength(65)
    expect(bytes[0]).toBe(0x04)
  })
})

describe('isIos', () => {
  test('iPhone', () => {
    fakeNavigator('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1')
    expect(isIos()).toBe(true)
  })

  test('iPad that reports itself as a Mac (it has a touch screen)', () => {
    fakeNavigator('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', 5)
    expect(isIos()).toBe(true)
  })

  test('a real Mac and Android are not iOS', () => {
    fakeNavigator('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', 0)
    expect(isIos()).toBe(false)
    fakeNavigator('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36', 5)
    expect(isIos()).toBe(false)
  })
})
