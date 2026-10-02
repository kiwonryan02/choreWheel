import { useActivity } from '../data/useActivity'
import { timeAgo } from '../lib/time'
import { useNow } from '../lib/useNow'
import type { ActivityEntry, Chore, Member } from '../types'

interface ActivityScreenProps {
  members: Member[]
  chores: Chore[]
}

/** "Sam did the dishes" / "Alex checked off 'Buy paper towels'", newest first. */
export default function ActivityScreen({ members, chores }: ActivityScreenProps) {
  const { entries, error, retry } = useActivity()
  const now = useNow()

  const memberOf = (id: string) => members.find((m) => m.id === id)
  const describe = (entry: ActivityEntry) => {
    if (entry.kind === 'chore') {
      const chore = chores.find((c) => c.id === entry.choreId)
      return `did the ${chore ? chore.name.toLowerCase() : 'chore'}`
    }
    return 'checked off a task'
  }

  if (!entries) {
    return (
      <div className="px-6 py-16 text-center text-slate-500 dark:text-slate-400">
        {error ? (
          <>
            <p className="font-semibold text-slate-900 dark:text-slate-100">Couldn't load the activity.</p>
            <p className="mt-2 text-sm break-words">{error}</p>
            <button
              type="button"
              onClick={() => void retry()}
              className="mt-6 rounded-2xl border-2 border-slate-300 px-6 py-3 font-semibold text-slate-900 dark:border-slate-700 dark:text-slate-100"
            >
              Try again
            </button>
          </>
        ) : (
          'Loading…'
        )}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <p className="px-6 py-16 text-center text-slate-500 dark:text-slate-400">
        Nothing yet. Finished chores show up here.
      </p>
    )
  }

  return (
    <ul className="divide-y divide-slate-200 px-6 dark:divide-slate-800">
      {entries.map((entry) => {
        const who = memberOf(entry.memberId)
        return (
          <li key={entry.id} className="flex items-center gap-3 py-3.5">
            <span
              className="size-3 shrink-0 rounded-full"
              style={{ backgroundColor: who?.color ?? '#94a3b8' }}
              aria-hidden="true"
            />
            <p className="min-w-0 flex-1">
              <span className="font-semibold">{who?.name ?? 'Someone'}</span> {describe(entry)}
            </p>
            <span className="shrink-0 text-sm text-slate-500 dark:text-slate-400">
              {timeAgo(entry.createdAt, now)}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
