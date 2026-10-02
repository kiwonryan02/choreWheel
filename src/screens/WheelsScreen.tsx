import { useState } from 'react'
import ChoreCard from '../components/ChoreCard'
import CompletionSheet from '../components/CompletionSheet'
import { bumpChore } from '../data/bump'
import { announceBump } from '../data/push'
import type { CompleteResult } from '../data/useHousehold'
import type { Chore, Member } from '../types'

interface WheelsScreenProps {
  chores: Chore[]
  me: Member
  passcode: string
  completeChore: (choreId: string, memberId: string, passcode: string) => Promise<CompleteResult>
  /** Reload the household from the server (used when the wheel moved under us). */
  refresh: () => Promise<void>
  showNotice: (message: string) => void
  onPasscodeRejected: () => void
}

const LOCKED = 'Too many wrong passcode tries. Wait a few minutes and try again.'
const OFFLINE = "Couldn't save that. Check your connection and try again."

/** The two wheels: mark done (with a confirm sheet) or anonymously bump. */
export default function WheelsScreen({
  chores,
  me,
  passcode,
  completeChore,
  refresh,
  showNotice,
  onPasscodeRejected,
}: WheelsScreenProps) {
  const [sheetChoreId, setSheetChoreId] = useState<string | null>(null)
  const sheetChore = chores.find((c) => c.id === sheetChoreId)
  const [bumpingChoreId, setBumpingChoreId] = useState<string | null>(null)

  async function handleConfirm(chore: Chore) {
    const result = await completeChore(chore.id, me.id, passcode)
    if (result === 'stale') showNotice('Someone already marked that done. The wheel is up to date.')
    else if (result === 'locked') showNotice(LOCKED)
    else if (result === 'invalid') onPasscodeRejected()
    else if (result === 'not_set' || result === 'error') showNotice(OFFLINE)
  }

  // The server is told who is being bumped, never who is bumping.
  async function handleBump(chore: Chore) {
    if (bumpingChoreId) return
    setBumpingChoreId(chore.id)
    const { status, bumpId } = await bumpChore(passcode, chore.id, chore.currentMemberId)
    setBumpingChoreId(null)

    if (status === 'sent') {
      showNotice("Nudge sent. They won't know it was you.")
      if (bumpId) void announceBump(bumpId)
    } else if (status === 'rate_limited') showNotice('Someone already nudged them recently.')
    else if (status === 'stale') {
      void refresh() // the wheel moved while this screen was open
      showNotice('The wheel just moved on. It now shows who is up.')
    } else if (status === 'locked') showNotice(LOCKED)
    else if (status === 'invalid') onPasscodeRejected()
    else showNotice(OFFLINE)
  }

  return (
    <>
      {chores.map((chore) => (
        <ChoreCard
          key={chore.id}
          chore={chore}
          meId={me.id}
          onMarkDone={() => setSheetChoreId(chore.id)}
          onBump={() => void handleBump(chore)}
          bumping={bumpingChoreId === chore.id}
        />
      ))}

      {sheetChore && (
        <CompletionSheet
          key={sheetChore.id}
          chore={sheetChore}
          color={me.color}
          onConfirm={() => void handleConfirm(sheetChore)}
          onClose={() => setSheetChoreId(null)}
        />
      )}
    </>
  )
}
