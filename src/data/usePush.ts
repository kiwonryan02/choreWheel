import { useCallback, useEffect, useRef, useState } from 'react'
import { getOrCreateSubscription, isIos, isPushSupported, isStandalone } from '../lib/push'
import { savePushSubscription } from './push'

/**
 * What the notifications banner should offer:
 * - unavailable: nothing to offer (no VAPID key configured, or unsupported browser)
 * - install:     iPhone/iPad in a browser tab; push only works from the home screen
 * - ask:         can request permission (must come from a tap)
 * - enabling:    waiting on the permission prompt / saving
 * - on:          subscribed
 * - blocked:     the user denied permission in browser or phone settings
 * - error:       permission granted but we couldn't save the subscription
 */
export type PushState = 'unavailable' | 'install' | 'ask' | 'enabling' | 'on' | 'blocked' | 'error'

const VAPID_PUBLIC_KEY: string | undefined = import.meta.env.VITE_VAPID_PUBLIC_KEY

function initialState(): PushState {
  if (!VAPID_PUBLIC_KEY) return 'unavailable'
  if (isIos() && !isStandalone()) return 'install'
  if (!isPushSupported()) return 'unavailable'
  if (Notification.permission === 'denied') return 'blocked'
  if (Notification.permission === 'granted') return 'on'
  return 'ask'
}

export function usePush(memberId: string, passcode: string, onPasscodeRejected: () => void) {
  const [state, setState] = useState<PushState>(initialState)

  // Read through a ref so a new callback identity never re-triggers a sync.
  const rejected = useRef(onPasscodeRejected)
  useEffect(() => {
    rejected.current = onPasscodeRejected
  })

  // Ensure this device has a subscription and that it is filed under the
  // current person. Returns whether it worked.
  const sync = useCallback(async (): Promise<boolean> => {
    if (!VAPID_PUBLIC_KEY) return false
    try {
      const keys = await getOrCreateSubscription(VAPID_PUBLIC_KEY)
      const status = await savePushSubscription(passcode, memberId, keys)
      if (status === 'invalid') rejected.current()
      return status === 'ok'
    } catch (err) {
      console.warn('Push subscription failed', err)
      return false
    }
  }, [memberId, passcode])

  // Already allowed on this device: keep the subscription current, and move it
  // to the new person if someone switches who they are.
  useEffect(() => {
    if (state === 'on') void sync()
  }, [state, sync])

  // Must run straight from a tap: iOS only shows the permission prompt then.
  const enable = useCallback(async () => {
    if (!isPushSupported()) return
    setState('enabling')
    const permission = await Notification.requestPermission()
    if (permission === 'denied') return setState('blocked')
    if (permission !== 'granted') return setState('ask')
    setState((await sync()) ? 'on' : 'error')
  }, [sync])

  return { state, enable }
}
