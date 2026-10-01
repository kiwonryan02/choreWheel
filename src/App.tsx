import { useEffect, useState } from 'react'
import ChoreCard from './components/ChoreCard'
import CompletionSheet from './components/CompletionSheet'
import { useHousehold } from './data/useHousehold'
import type { Chore } from './types'

function App() {
  const { members, chores, loaded, error, live, completeChore, retry } = useHousehold()

  // TODO(M3): replace with the "Who are you?" picker persisted in localStorage.
  // Until then everyone is the first member, and dev builds get a "View as"
  // selector to preview both button states.
  const [pickedMeId, setPickedMeId] = useState<string | null>(null)
  const meId = pickedMeId ?? members[0]?.id ?? null
  const me = members.find((m) => m.id === meId)

  const [sheetChoreId, setSheetChoreId] = useState<string | null>(null)
  const sheetChore = chores.find((c) => c.id === sheetChoreId)

  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  async function handleConfirm(chore: Chore) {
    if (!meId) return
    const result = await completeChore(chore.id, meId)
    if (result === 'stale') setNotice('Someone already marked that done. The wheel is up to date.')
    if (result === 'error') setNotice("Couldn't save that. Check your connection and try again.")
  }

  return (
    <div className="mx-auto max-w-md">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between bg-slate-50/90 px-6 backdrop-blur dark:bg-slate-950/90">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold tracking-tight">Chore Wheel</h1>
          {loaded && (
            <span
              title={live ? 'Live updates on' : 'Reconnecting…'}
              className={`size-2 rounded-full ${live ? 'bg-emerald-500' : 'bg-amber-500'}`}
            />
          )}
        </div>
        {import.meta.env.DEV && members.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            View as
            <select
              value={meId ?? ''}
              onChange={(e) => setPickedMeId(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      <main>
        {!loaded && !error && (
          <p className="py-24 text-center text-slate-500 dark:text-slate-400">Loading…</p>
        )}

        {!loaded && error && (
          <div className="px-6 py-24 text-center">
            <p className="font-semibold">Couldn't load the wheels.</p>
            <p className="mt-2 text-sm break-words text-slate-500 dark:text-slate-400">{error}</p>
            <button
              type="button"
              onClick={() => void retry()}
              className="mt-6 rounded-2xl border-2 border-slate-300 px-6 py-3 font-semibold dark:border-slate-700"
            >
              Try again
            </button>
          </div>
        )}

        {chores.map((chore) => (
          <ChoreCard
            key={chore.id}
            chore={chore}
            meId={meId}
            onMarkDone={() => setSheetChoreId(chore.id)}
            // TODO(M5): bump RPC with global rate limit.
            onBump={() => {}}
          />
        ))}
      </main>

      {sheetChore && me && (
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

export default App
