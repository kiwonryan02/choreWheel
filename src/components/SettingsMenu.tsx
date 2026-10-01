import { useEffect, useState } from 'react'
import type { Member } from '../types'

interface SettingsMenuProps {
  me: Member
  onSwitchPerson: () => void
  /** Forget the passcode on this device; the passcode screen comes back. */
  onLock: () => void
}

export default function SettingsMenu({ me, onSwitchPerson, onLock }: SettingsMenuProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const choose = (action: () => void) => () => {
    setOpen(false)
    action()
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-slate-300 bg-white py-1.5 pr-3 pl-2.5 text-sm font-medium dark:border-slate-700 dark:bg-slate-900"
      >
        <span className="size-2.5 rounded-full" style={{ backgroundColor: me.color }} />
        {me.name}
        <svg viewBox="0 0 12 12" className="size-3 text-slate-400" aria-hidden="true">
          <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-2xl bg-white py-1 shadow-lg ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700"
          >
            <button
              type="button"
              role="menuitem"
              onClick={choose(onSwitchPerson)}
              className="block w-full px-4 py-3 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Switch person
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={choose(onLock)}
              className="block w-full px-4 py-3 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Lock this device
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                Forget the passcode here
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
