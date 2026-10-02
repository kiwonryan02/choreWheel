import { useState } from 'react'
import { REACTIONS, type ReactionKind } from '../config/reactions'
import type { ReactionResult } from '../data/useActivity'
import { useActivity } from '../data/useActivity'
import { timeAgo } from '../lib/time'
import { useNow } from '../lib/useNow'
import type { ActivityEntry, Chore, Member } from '../types'

interface ActivityScreenProps {
  members: Member[]
  chores: Chore[]
  me: Member
  passcode: string
  showNotice: (message: string) => void
  onPasscodeRejected: () => void
}

/** "Sam did the dishes" / "Alex checked off 'Buy paper towels'", newest first, with reactions. */
export default function ActivityScreen({ members, chores, me, passcode, showNotice, onPasscodeRejected }: ActivityScreenProps) {
  const { entries, error, retry, setReaction } = useActivity(passcode)
  const now = useNow()

  const memberOf = (id: string) => members.find((m) => m.id === id)
  const describe = (entry: ActivityEntry) => {
    if (entry.kind === 'chore') {
      const chore = chores.find((c) => c.id === entry.choreId)
      return `did the ${chore ? chore.name.toLowerCase() : 'chore'}`
    }
    return entry.todoText ? `checked off '${entry.todoText}'` : 'checked off a task'
  }

  async function react(entry: ActivityEntry, kind: ReactionKind, on: boolean) {
    const result: ReactionResult = await setReaction(entry.id, kind, on, me.id)
    if (result === 'invalid') onPasscodeRejected()
    else if (result === 'locked') showNotice('Too many wrong passcode tries. Wait a few minutes and try again.')
    else if (result === 'not_found') showNotice('That entry was removed.')
    else if (result === 'error') showNotice("Couldn't save that. Check your connection and try again.")
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
        Nothing yet. Finished chores and tasks show up here.
      </p>
    )
  }

  return (
    <ul className="divide-y divide-slate-200 px-6 dark:divide-slate-800">
      {entries.map((entry) => {
        const who = memberOf(entry.memberId)
        return (
          <li key={entry.id} className="py-3.5">
            <div className="flex items-center gap-3">
              <span
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: who?.color ?? '#94a3b8' }}
                aria-hidden="true"
              />
              <p className="min-w-0 flex-1 break-words">
                <span className="font-semibold">{who?.name ?? 'Someone'}</span> {describe(entry)}
              </p>
              <span className="shrink-0 text-sm text-slate-500 dark:text-slate-400">
                {timeAgo(entry.createdAt, now)}
              </span>
            </div>
            <Reactions entry={entry} members={members} me={me} onReact={(kind, on) => void react(entry, kind, on)} />
          </li>
        )
      })}
    </ul>
  )
}

interface ReactionsProps {
  entry: ActivityEntry
  members: Member[]
  me: Member
  onReact: (kind: ReactionKind, on: boolean) => void
}

/** Chips for the reactions an entry has (tap to add or take back yours), plus a "+" to add another. */
function Reactions({ entry, members, me, onReact }: ReactionsProps) {
  const [picking, setPicking] = useState(false)
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? 'Someone'

  const used = REACTIONS.filter((r) => entry.reactions.some((x) => x.kind === r.kind))
  const unused = REACTIONS.filter((r) => !used.includes(r))

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-6">
      {used.map((r) => {
        const who = entry.reactions.filter((x) => x.kind === r.kind).map((x) => nameOf(x.memberId))
        const mine = entry.reactions.some((x) => x.kind === r.kind && x.memberId === me.id)
        return (
          <button
            key={r.kind}
            type="button"
            aria-pressed={mine}
            aria-label={`${r.label}: ${who.join(', ')}${mine ? ' (tap to take yours back)' : ''}`}
            title={who.join(', ')}
            onClick={() => onReact(r.kind, !mine)}
            className={`rounded-full border px-2.5 py-1 text-sm ${
              mine
                ? 'border-blue-500 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100'
                : 'border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-300'
            }`}
          >
            {r.emoji} {who.length}
          </button>
        )
      })}

      {picking &&
        unused.map((r) => (
          <button
            key={r.kind}
            type="button"
            aria-label={`React with ${r.label}`}
            onClick={() => {
              setPicking(false)
              onReact(r.kind, true)
            }}
            className="rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-sm dark:border-slate-700"
          >
            {r.emoji}
          </button>
        ))}

      {unused.length > 0 && (
        <button
          type="button"
          aria-label={picking ? 'Close reactions' : 'Add a reaction'}
          aria-expanded={picking}
          onClick={() => setPicking((p) => !p)}
          className="rounded-full border border-slate-300 px-2.5 py-1 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400"
        >
          {picking ? '×' : '＋'}
        </button>
      )}
    </div>
  )
}
