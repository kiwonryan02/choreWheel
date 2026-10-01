import type { Member } from '../types'

interface WhoAreYouProps {
  members: Member[]
  /** Set when switching person from the menu; lets them back out. */
  onCancel?: () => void
  onPick: (memberId: string) => void
}

/** Per-device identity picker. No login: four trusted roommates, one tap. */
export default function WhoAreYou({ members, onCancel, onPick }: WhoAreYouProps) {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center px-6">
      <h1 className="text-3xl font-bold tracking-tight">Who are you?</h1>
      <p className="mt-1 text-slate-500 dark:text-slate-400">Tap your name. You can change this later.</p>

      <div className="mt-8 grid w-full max-w-xs grid-cols-2 gap-3">
        {members.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onPick(m.id)}
            className="rounded-2xl px-4 py-6 text-xl font-semibold text-white shadow-md transition active:scale-[0.97]"
            style={{ backgroundColor: m.color }}
          >
            {m.name}
          </button>
        ))}
      </div>

      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="mt-8 text-sm font-medium text-slate-500 underline underline-offset-4 dark:text-slate-400"
        >
          Cancel
        </button>
      )}
    </main>
  )
}
