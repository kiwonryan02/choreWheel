import { useState, type FormEvent } from 'react'
import { verifyPasscode } from '../data/passcode'

interface PasscodeGateProps {
  /** Shown above the form, e.g. when a saved passcode stopped working. */
  notice?: string | null
  onUnlock: (passcode: string) => void
}

const MESSAGES = {
  invalid: "That passcode isn't right.",
  locked: 'Too many wrong tries. Wait about 15 minutes, then try again.',
  not_set: "The household passcode hasn't been set up yet.",
  error: "Couldn't reach the server. Check your connection and try again.",
} as const

export default function PasscodeGate({ notice, onUnlock }: PasscodeGateProps) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const valid = /^[0-9]{4,6}$/.test(value)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || checking) return
    setChecking(true)
    setError(null)
    const status = await verifyPasscode(value)
    setChecking(false)
    if (status === 'ok') onUnlock(value)
    else {
      setError(MESSAGES[status])
      if (status === 'invalid') setValue('')
    }
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center px-6">
      <div className="text-5xl">🔒</div>
      <h1 className="mt-4 text-2xl font-bold tracking-tight">Lack App</h1>
      <p className="mt-1 text-center text-slate-500 dark:text-slate-400">
        Enter the household passcode. You'll only need to do this once on this device.
      </p>

      {notice && (
        <p role="status" className="mt-4 rounded-xl bg-amber-100 px-4 py-2 text-center text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {notice}
        </p>
      )}

      <form onSubmit={submit} className="mt-8 w-full max-w-xs">
        <label htmlFor="passcode" className="sr-only">
          Household passcode
        </label>
        <input
          id="passcode"
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          autoComplete="off"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
          placeholder="••••"
          className="w-full rounded-2xl border-2 border-slate-300 bg-white px-4 py-4 text-center text-3xl tracking-[0.5em] outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900"
        />
        <p role="alert" className="mt-3 min-h-5 text-center text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
        <button
          type="submit"
          disabled={!valid || checking}
          className="mt-3 w-full rounded-2xl bg-slate-900 px-6 py-4 text-lg font-semibold text-white shadow-md transition active:scale-[0.98] disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
        >
          {checking ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </main>
  )
}
