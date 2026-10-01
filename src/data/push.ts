import { supabase } from '../lib/supabase'
import type { PushKeys } from '../lib/push'

export type SaveSubscriptionStatus = 'ok' | 'invalid' | 'locked' | 'not_set' | 'unknown_member'

/** Remembers this device's subscription for a member. Safe to call repeatedly. */
export async function savePushSubscription(
  passcode: string,
  memberId: string,
  keys: PushKeys,
): Promise<SaveSubscriptionStatus | 'error'> {
  const { data, error } = await supabase.rpc('save_push_subscription', {
    p_passcode: passcode,
    p_member_id: memberId,
    p_endpoint: keys.endpoint,
    p_p256dh: keys.p256dh,
    p_auth: keys.auth,
  })
  if (error || typeof data !== 'string') return 'error'
  return data as SaveSubscriptionStatus
}

/**
 * Asks the notify Edge Function to ping everyone about a completed chore.
 * The function sends at most one notification per activity row, so retrying
 * is safe. Failures are logged and swallowed: the chore is already done.
 */
export async function announceCompletion(activityId: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { error } = await supabase.functions.invoke('notify', {
      body: { type: 'chore_completed', activity_id: activityId },
    })
    if (!error) return
    if (attempt === 3) console.warn('Could not send completion notifications', error)
    else await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
  }
}
