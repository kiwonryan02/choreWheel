import { supabase } from '../lib/supabase'

export type PasscodeStatus = 'ok' | 'invalid' | 'locked' | 'not_set'

/** Asks the server whether this is the household passcode. 'error' means we couldn't ask. */
export async function verifyPasscode(passcode: string): Promise<PasscodeStatus | 'error'> {
  const { data, error } = await supabase.rpc('verify_passcode', { p_passcode: passcode })
  if (error || typeof data !== 'string') return 'error'
  return data as PasscodeStatus
}
