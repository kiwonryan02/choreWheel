import { useEffect, useState, type ReactNode } from 'react'
import Notifications from '../components/Notifications'
import Nudges from '../components/Nudges'
import SettingsMenu from '../components/SettingsMenu'
import TabBar, { type TabDef } from '../components/TabBar'
import { useHousehold } from '../data/useHousehold'
import { useTodos } from '../data/useTodos'
import { readStored, STORAGE_KEYS, writeStored } from '../lib/storage'
import ActivityScreen from './ActivityScreen'
import TodosScreen from './TodosScreen'
import WheelsScreen from './WheelsScreen'
import WhoAreYou from './WhoAreYou'

interface HomeProps {
  passcode: string
  /** The server said the saved passcode is wrong (it was changed). */
  onPasscodeRejected: () => void
  onLock: () => void
}

type TabId = 'wheels' | 'todos' | 'activity'

const icon = (path: ReactNode) => (
  <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
)

const WHEELS_ICON = icon(
  <>
    <circle cx="12" cy="12" r="8" strokeDasharray="3 3" />
    <circle cx="12" cy="4.5" r="2.5" fill="currentColor" />
    <circle cx="19.5" cy="12" r="1.5" fill="currentColor" />
    <circle cx="12" cy="19.5" r="1.5" fill="currentColor" />
    <circle cx="4.5" cy="12" r="1.5" fill="currentColor" />
  </>,
)
const TODOS_ICON = icon(
  <>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="m3.5 6 1.2 1.2L6.8 5M3.5 12l1.2 1.2L6.8 11M3.5 18l1.2 1.2L6.8 17" />
  </>,
)
const ACTIVITY_ICON = icon(
  <>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </>,
)

/** Everything after the passcode: identity, the header, the tabs, and the toast. */
export default function Home({ passcode, onPasscodeRejected, onLock }: HomeProps) {
  const { members, chores, loaded, error, live, completeChore, retry } = useHousehold()
  const todos = useTodos(passcode)

  const [memberId, setMemberId] = useState<string | null>(() => readStored(STORAGE_KEYS.memberId))
  const [switching, setSwitching] = useState(false)
  const me = members.find((m) => m.id === memberId)

  const [tab, setTab] = useState<TabId>('wheels')
  const changeTab = (next: TabId) => {
    setTab(next)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

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

  const tabs: TabDef<TabId>[] = [
    { id: 'wheels', label: 'Wheels', icon: WHEELS_ICON },
    { id: 'todos', label: 'Todos', icon: TODOS_ICON, badge: todos.open.length },
    { id: 'activity', label: 'Activity', icon: ACTIVITY_ICON },
  ]

  return (
    // snap-start on the wrapper gives the top of the page (header + notification
    // banner) its own snap point, so the banner isn't scrolled away on load.
    // The bottom padding keeps content clear of the fixed tab bar.
    <div className="mx-auto max-w-md snap-start pb-[calc(4rem+env(safe-area-inset-bottom))]">
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

      {/* Always mounted, whichever tab is showing: they keep subscriptions and nudges current. */}
      <Notifications memberId={me.id} passcode={passcode} onPasscodeRejected={onPasscodeRejected} />
      <Nudges memberId={me.id} passcode={passcode} chores={chores} onPasscodeRejected={onPasscodeRejected} />

      {/* Every tab stays mounted (just hidden), so each keeps its state and live connection. */}
      <main>
        <div hidden={tab !== 'wheels'}>
          <WheelsScreen
            chores={chores}
            me={me}
            passcode={passcode}
            completeChore={completeChore}
            refresh={retry}
            showNotice={setNotice}
            onPasscodeRejected={onPasscodeRejected}
          />
        </div>
        <div hidden={tab !== 'todos'}>
          <TodosScreen
            members={members}
            me={me}
            todos={todos}
            showNotice={setNotice}
            onPasscodeRejected={onPasscodeRejected}
          />
        </div>
        <div hidden={tab !== 'activity'}>
          <ActivityScreen members={members} chores={chores} />
        </div>
      </main>

      <TabBar tabs={tabs} active={tab} onChange={changeTab} />

      {notice && (
        <div
          role="status"
          className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-sm rounded-2xl bg-slate-900 px-4 py-3 text-center text-sm text-white shadow-lg dark:bg-slate-100 dark:text-slate-900"
        >
          {notice}
        </div>
      )}
    </div>
  )
}
