import { useEffect, useRef, useState } from 'react'
import type { Chore } from '../types'

interface CompletionSheetProps {
  chore: Chore
  color: string
  onConfirm: () => void
  onClose: () => void
}

const EXIT_MS = 200

/**
 * Bottom sheet that confirms marking a chore done. What "done" means is shown
 * on the chore card itself, so this is just a guard against accidental taps.
 */
export default function CompletionSheet({ chore, color, onConfirm, onClose }: CompletionSheetProps) {
  const [shown, setShown] = useState(false)
  const closing = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const currentIndex = chore.rotation.findIndex((m) => m.id === chore.currentMemberId)
  const next = chore.rotation[(currentIndex + 1) % chore.rotation.length]

  // Slide in on mount; clear any pending exit timer on unmount.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true))
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer.current)
    }
  }, [])

  function dismiss(afterExit: () => void) {
    if (closing.current) return
    closing.current = true
    setShown(false)
    timer.current = setTimeout(afterExit, EXIT_MS)
  }

  const cancel = () => dismiss(onClose)
  const confirm = () => {
    // Fire immediately so the wheel starts turning behind the closing sheet.
    onConfirm()
    dismiss(onClose)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="fixed inset-0 z-30">
      <div
        onClick={cancel}
        className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        className={`absolute inset-x-0 bottom-0 mx-auto max-w-md rounded-t-3xl bg-white px-6 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl transition-transform duration-200 ease-out dark:bg-slate-900 ${shown ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-300 dark:bg-slate-700" />
        <h2 id="sheet-title" className="text-xl font-semibold">
          {chore.emoji} Mark {chore.name.toLowerCase()} done?
        </h2>
        {next && (
          <p className="mt-1 text-slate-500 dark:text-slate-400">
            The wheel will move on to{' '}
            <span className="font-semibold" style={{ color: next.color }}>
              {next.name}
            </span>
            .
          </p>
        )}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={cancel}
            className="flex-1 rounded-2xl border-2 border-slate-300 px-4 py-3.5 text-base font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            className="flex-[2] rounded-2xl px-4 py-3.5 text-base font-semibold text-white shadow-md active:scale-[0.98]"
            style={{ backgroundColor: color }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}
