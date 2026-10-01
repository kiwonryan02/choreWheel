import { useState } from 'react'
import type { PushState } from '../data/usePush'
import { readStored, writeStored } from '../lib/storage'

interface NotificationBannerProps {
  state: PushState
  onEnable: () => void
}

const HIDE_INSTALL_TIP_KEY = 'chorewheel.hideInstallTip'

/** First-run strip: install to the home screen (iOS) and turn on notifications. */
export default function NotificationBanner({ state, onEnable }: NotificationBannerProps) {
  const [hideInstall, setHideInstall] = useState(() => readStored(HIDE_INSTALL_TIP_KEY) === '1')
  const [hideBlocked, setHideBlocked] = useState(false)

  const card =
    'mx-6 mt-1 rounded-2xl bg-white px-4 py-3 text-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800'
  const primary =
    'mt-2 w-full rounded-xl bg-slate-900 px-4 py-2.5 font-semibold text-white active:scale-[0.98] disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900'

  if (state === 'install' && !hideInstall) {
    return (
      <div className={card}>
        <p className="font-semibold">Get a ping when a chore is done</p>
        <p className="mt-1 text-slate-600 dark:text-slate-400">
          On iPhone, notifications only work once the app is on your home screen:
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-600 dark:text-slate-400">
          <li>
            Tap the <span className="font-semibold">Share</span> button in Safari
          </li>
          <li>
            Choose <span className="font-semibold">Add to Home Screen</span>
          </li>
          <li>Open it from your home screen and tap Enable notifications</li>
        </ol>
        <button
          type="button"
          onClick={() => {
            writeStored(HIDE_INSTALL_TIP_KEY, '1')
            setHideInstall(true)
          }}
          className="mt-2 text-xs font-medium text-slate-500 underline underline-offset-4 dark:text-slate-400"
        >
          Not now
        </button>
      </div>
    )
  }

  if (state === 'ask' || state === 'enabling' || state === 'error') {
    return (
      <div className={card}>
        <p className="font-semibold">Get a ping when a chore is done</p>
        {state === 'error' && (
          <p role="alert" className="mt-1 text-rose-600 dark:text-rose-400">
            Couldn't turn notifications on. Check your connection and try again.
          </p>
        )}
        <button type="button" onClick={onEnable} disabled={state === 'enabling'} className={primary}>
          {state === 'enabling' ? 'Enabling…' : 'Enable notifications'}
        </button>
      </div>
    )
  }

  if (state === 'blocked' && !hideBlocked) {
    return (
      <div className={card}>
        <p className="text-slate-600 dark:text-slate-400">
          Notifications are blocked for this app. Turn them on in your browser or phone settings to
          get pings.
        </p>
        <button
          type="button"
          onClick={() => setHideBlocked(true)}
          className="mt-2 text-xs font-medium text-slate-500 underline underline-offset-4 dark:text-slate-400"
        >
          Dismiss
        </button>
      </div>
    )
  }

  return null
}
