import { useNudges } from '../data/useNudges'
import type { Chore } from '../types'
import NudgeBanner from './NudgeBanner'

interface NudgesProps {
  memberId: string
  passcode: string
  chores: Chore[]
  onPasscodeRejected: () => void
}

/** Mounted only once we know who is using the device. */
export default function Nudges({ memberId, passcode, chores, onPasscodeRejected }: NudgesProps) {
  // Changes whenever any wheel changes hands, so nudges are re-checked right away.
  const wheelState = chores.map((c) => `${c.id}:${c.currentMemberId}`).join(',')
  const { nudges, dismiss } = useNudges(memberId, passcode, wheelState, onPasscodeRejected)

  return (
    <>
      {nudges.map((nudge) => {
        const chore = chores.find((c) => c.id === nudge.choreId)
        if (!chore) return null
        return <NudgeBanner key={nudge.choreId} choreName={chore.name} onDismiss={() => dismiss(nudge)} />
      })}
    </>
  )
}
