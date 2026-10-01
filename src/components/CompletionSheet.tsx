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
 * Bottom sheet showing what "done" means for a chore. The checkboxes are only
 * a reference for the person doing the chore: nothing is required, validated
 * or stored, and Confirm is always enabled.
 */
export default function CompletionSheet({ chore, color, onConfirm, onClose }: CompletionSheetProps) {
  const [checked, setChecked] = useState<boolean[]>(() => chore.checklist.map(() => false))
  const [shown, setShown] = useState(false)
  const closing = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

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
          {chore.emoji} {chore.name}: what "done" means
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          A quick reference. Tick what you like, nothing is required.
        </p>

        <ul className="mt-4 space-y-3">
          {chore.checklist.map((item, i) => (
            <li key={item}>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={checked[i]}
                  onChange={() => setChecked((all) => all.map((v, j) => (j === i ? !v : v)))}
                  className="mt-0.5 size-6 shrink-0"
                  style={{ accentColor: color }}
                />
                <span className="text-base leading-snug">{item}</span>
              </label>
            </li>
          ))}
        </ul>

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
