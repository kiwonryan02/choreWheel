import { useEffect, useState } from 'react'
import ChoreCard from '../components/ChoreCard'
import CompletionSheet from '../components/CompletionSheet'
import Notifications from '../components/Notifications'
import Nudges from '../components/Nudges'
import SettingsMenu from '../components/SettingsMenu'
import { bumpChore } from '../data/bump'
import { announceBump } from '../data/push'
import { useHousehold } from '../data/useHousehold'
import { readStored, STORAGE_KEYS, writeStored } from '../lib/storage'
import type { Chore } from '../types'
import WhoAreYou from './WhoAreYou'

interface HomeProps {
  passcode: string
  /** The server said the saved passcode is wrong (it was changed). */
  onPasscodeRejected: () => void
  onLock: () => void
}

export default function Home({ passcode, onPasscodeRejected, onLock }: HomeProps) {
  const { members, chores, loaded, error, live, completeChore, retry } = useHousehold()

  const [memberId, setMemberId] = useState<string | null>(() => readStored(STORAGE_KEYS.memberId))
  const [switching, setSwitching] = useState(false)
  const me = members.find((m) => m.id === memberId)

  const [sheetChoreId, setSheetChoreId] = useState<string | null>(null)
  const sheetChore = chores.find((c) => c.id === sheetChoreId)

  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  function pickMember(id: string) {
    writeStored(STORAGE_KEYS.memberId, id)
    setMemberId(id)
    setSwitching(false)
  }

  async function handleConfirm(chore: Chore) {
    if (!me) return
    const result = await completeChore(chore.id, me.id, passcode)
    if (result === 'stale') setNotice('Someone already marked that done. The wheel is up to date.')
    else if (result === 'locked') setNotice('Too many wrong passcode tries. Wait a few minutes and try again.')
    else if (result === 'invalid') onPasscodeRejected()
    else if (result === 'not_set' || result === 'error')
      setNotice("Couldn't save that. Check your connection and try again.")
  }

  const [bumpingChoreId, setBumpingChoreId] = useState<string | null>(null)

  // The server is told who is being bumped, never who is bumping.
  async function handleBump(chore: Chore) {
    if (bumpingChoreId) return
    setBumpingChoreId(chore.id)
    const { status, bumpId } = await bumpChore(passcode, chore.id, chore.currentMemberId)
    setBumpingChoreId(null)

    if (status === 'sent') {
      setNotice("Nudge sent. They won't know it was you.")
      if (bumpId) void announceBump(bumpId)
    } else if (status === 'rate_limited') setNotice('Someone already nudged them recently.')
    else if (status === 'stale') {
      void retry() // the wheel moved while this screen was open
      setNotice('The wheel just moved on. It now shows who is up.')
    } else if (status === 'locked') setNotice('Too many wrong passcode tries. Wait a few minutes and try again.')
    else if (status === 'invalid') onPasscodeRejected()
    else setNotice("Couldn't send that. Check your connection and try again.")
  }

  if (!loaded) {
    return (
      <main className="mx-auto max-w-md px-6 py-24 text-center">
        {error ? (
          <>
            <p className="font-semibold">Couldn't load the wheels.</p>
            <p className="mt-2 text-sm break-words text-slate-500 dark:text-slate-400">{error}</p>
            <button
              type="button"
              onClick={() => void retry()}
              className="mt-6 rounded-2xl border-2 border-slate-300 px-6 py-3 font-semibold dark:border-slate-700"
            >
              Try again
            </button>
          </>
        ) : (
          <p className="text-slate-500 dark:text-slate-400">Loading…</p>
        )}
      </main>
    )
  }

  // First launch (no saved identity, or it no longer matches anyone), or switching.
  if (!me || switching) {
    return (
      <WhoAreYou
        members={members}
        onPick={pickMember}
        onCancel={me ? () => setSwitching(false) : undefined}
      />
    )
  }

  return (
    // snap-start on the wrapper gives the top of the page (header + notification
    // banner) its own snap point, so the banner isn't scrolled away on load.
    <div className="mx-auto max-w-md snap-start">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between bg-slate-50/90 px-6 backdrop-blur dark:bg-slate-950/90">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold tracking-tight">LACK Chore Wheel</h1>
          <span
            title={live ? 'Live updates on' : 'Reconnecting…'}
            className={`size-2 rounded-full ${live ? 'bg-emerald-500' : 'bg-amber-500'}`}
          />
        </div>
        <SettingsMenu me={me} onSwitchPerson={() => setSwitching(true)} onLock={onLock} />
      </header>

      <Notifications memberId={me.id} passcode={passcode} onPasscodeRejected={onPasscodeRejected} />
      <Nudges memberId={me.id} passcode={passcode} chores={chores} onPasscodeRejected={onPasscodeRejected} />

      <main>
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
      </main>

      {sheetChore && (
        <CompletionSheet
          key={sheetChore.id}
          chore={sheetChore}
          color={me.color}
          onConfirm={() => void handleConfirm(sheetChore)}
          onClose={() => setSheetChoreId(null)}
        />
      )}

      {notice && (
        <div
          role="status"
          className="fixed inset-x-4 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-40 mx-auto max-w-sm rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm text-white shadow-lg dark:bg-slate-100 dark:text-slate-900"
        >
          {notice}
        </div>
      )}
    </div>
  )
}
