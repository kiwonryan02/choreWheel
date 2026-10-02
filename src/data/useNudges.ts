import { useCallback, useEffect, useRef, useState } from 'react'
import { readStored, writeStored } from '../lib/storage'
import { fetchNudges, type Nudge } from './bump'

const POLL_MS = 60_000
const seenKey = (choreId: string) => `chorewheel.nudgeSeen.${choreId}`

/**
 * Nudges aimed at this person that they haven't dismissed yet. Bumps aren't
 * broadcast over Realtime (the table is private), so this asks on load, when
 * the app comes back to the foreground, when the wheel changes, and once a
 * minute while open. `refreshKey` should change whenever the wheel does.
 */
export function useNudges(
  memberId: string,
  passcode: string,
  refreshKey: string,
  onPasscodeRejected: () => void,
) {
  const [nudges, setNudges] = useState<Nudge[]>([])
  const [, bump] = useState(0) // re-render after a dismissal

  const rejected = useRef(onPasscodeRejected)
  useEffect(() => {
    rejected.current = onPasscodeRejected
  })

  const load = useCallback(async () => {
    const result = await fetchNudges(passcode, memberId)
    if (result.status === 'ok') setNudges(result.nudges)
    // The saved passcode no longer works: stop here. Polling with it would
    // count as wrong guesses against the household's lockout.
    else if (result.status === 'invalid') rejected.current()
  }, [passcode, memberId])

  useEffect(() => {
    void load()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(onVisible, POLL_MS)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
    }
    // refreshKey: reload right after the wheel changes hands.
  }, [load, refreshKey])

  const unseen = nudges.filter((n) => {
    const seen = readStored(seenKey(n.choreId))
    return !seen || Date.parse(n.nudgedAt) > Date.parse(seen)
  })

  const dismiss = (nudge: Nudge) => {
    writeStored(seenKey(nudge.choreId), nudge.nudgedAt)
    bump((n) => n + 1)
  }

  return { nudges: unseen, dismiss }
}
