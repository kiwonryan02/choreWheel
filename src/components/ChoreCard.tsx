import { timeAgo } from '../lib/time'
import { useNow } from '../lib/useNow'
import type { Chore } from '../types'
import Wheel from './Wheel'

interface ChoreCardProps {
  chore: Chore
  /** The member using this device, or null before they pick who they are. */
  meId: string | null
  onMarkDone: () => void
  onBump: () => void
}

export default function ChoreCard({ chore, meId, onMarkDone, onBump }: ChoreCardProps) {
  const now = useNow()
  const current = chore.rotation.find((m) => m.id === chore.currentMemberId)
  if (!current) return null

  // Only the person on top can complete a chore ("Mark done"); everyone else can
  // only bump. TODO(v1 edge case, out of scope): someone else did the chore on
  // that person's behalf and wants to clear it for them.
  const isMyTurn = meId === chore.currentMemberId

  return (
    <section className="flex min-h-[calc(100svh-3.5rem)] scroll-mt-14 snap-start flex-col items-center justify-center gap-6 px-6 py-8">
      <Wheel
        members={chore.rotation}
        currentId={chore.currentMemberId}
        emoji={chore.emoji}
        label={chore.name}
      />

      <div className="text-center">
        <p className="text-2xl font-semibold">
          Up now:{' '}
          <span style={{ color: current.color }}>{current.name}</span>
        </p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Since {timeAgo(chore.since, now)}
        </p>
      </div>

      {isMyTurn ? (
        <button
          type="button"
          onClick={onMarkDone}
          className="w-full max-w-xs rounded-2xl px-6 py-4 text-lg font-semibold text-white shadow-md transition active:scale-[0.98]"
          style={{ backgroundColor: current.color }}
        >
          Mark done
        </button>
      ) : (
        <button
          type="button"
          onClick={onBump}
          className="w-full max-w-xs rounded-2xl border-2 border-slate-300 px-6 py-4 text-lg font-semibold text-slate-700 transition active:scale-[0.98] dark:border-slate-700 dark:text-slate-200"
        >
          Bump {current.name}
        </button>
      )}
    </section>
  )
}
