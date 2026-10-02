import type { ReactNode } from 'react'

export interface TabDef<Id extends string> {
  id: Id
  label: string
  icon: ReactNode
  /** Small count shown on the tab, e.g. open todos. Hidden when 0 or undefined. */
  badge?: number
}

interface TabBarProps<Id extends string> {
  tabs: TabDef<Id>[]
  active: Id
  onChange: (id: Id) => void
}

/** Bottom navigation. Sits above the home indicator on notched phones. */
export default function TabBar<Id extends string>({ tabs, active, onChange }: TabBarProps<Id>) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-slate-50/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95"
    >
      <ul className="mx-auto flex h-16 max-w-md">
        {tabs.map((tab) => {
          const selected = tab.id === active
          return (
            <li key={tab.id} className="flex-1">
              <button
                type="button"
                onClick={() => onChange(tab.id)}
                aria-current={selected ? 'page' : undefined}
                className={`relative flex h-full w-full flex-col items-center justify-center gap-0.5 text-xs font-medium ${
                  selected ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <span className="relative">
                  {tab.icon}
                  {tab.badge ? (
                    <span className="absolute -top-1.5 -right-3 min-w-4 rounded-full bg-rose-600 px-1 text-center text-[0.65rem] leading-4 font-bold text-white">
                      {tab.badge > 99 ? '99+' : tab.badge}
                    </span>
                  ) : null}
                </span>
                {tab.label}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
