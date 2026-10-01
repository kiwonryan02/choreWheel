// Per-device settings. localStorage can throw (private windows, blocked site
// data), so the app must keep working when it does: you just re-enter things.

export const STORAGE_KEYS = {
  passcode: 'chorewheel.passcode',
  memberId: 'chorewheel.memberId',
} as const

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Not persisted; the app still works for this session.
  }
}
