import { useState } from 'react'
import ChoreCard from './components/ChoreCard'
import { CHORES, MEMBERS } from './config/household'

function App() {
  // TODO(M3): replace with the "Who are you?" picker persisted in localStorage.
  // For M1 this dev-only selector lets us preview both button states.
  const [meId, setMeId] = useState<string | null>(MEMBERS[0].id)

  // TODO(M2): remove. State comes from Supabase and completion goes through
  // the complete_chore RPC. Until then, dev builds advance the wheel locally
  // so the rotation animation can be previewed.
  const [chores, setChores] = useState(CHORES)
  function advanceLocally(slug: string) {
    setChores((all) =>
      all.map((chore) => {
        if (chore.slug !== slug) return chore
        const i = chore.rotation.findIndex((m) => m.id === chore.currentMemberId)
        const next = chore.rotation[(i + 1) % chore.rotation.length]
        return { ...chore, currentMemberId: next.id, since: new Date() }
      }),
    )
  }

  return (
    <div className="mx-auto max-w-md">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between bg-slate-50/90 px-6 backdrop-blur dark:bg-slate-950/90">
        <h1 className="text-lg font-bold tracking-tight">Chore Wheel</h1>
        {import.meta.env.DEV && (
          <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            View as
            <select
              value={meId ?? ''}
              onChange={(e) => setMeId(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {MEMBERS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      <main>
        {chores.map((chore) => (
          <ChoreCard
            key={chore.slug}
            chore={chore}
            meId={meId}
            // TODO(M2): completion sheet + complete_chore RPC.
            onMarkDone={() => import.meta.env.DEV && advanceLocally(chore.slug)}
            // TODO(M5): bump RPC with global rate limit.
            onBump={() => {}}
          />
        ))}
      </main>
    </div>
  )
}

export default App
