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
 * Asks the notify Edge Function to send notifications for something that just
 * happened. The function sends at most once per row, so retrying is safe.
 * Failures are logged and swallowed: the underlying action already succeeded.
 */
async function invokeNotify(body: Record<string, string>, what: string): Promise<void> {
  // Push is only wired up when this deployment has a VAPID public key.
  if (!import.meta.env.VITE_VAPID_PUBLIC_KEY) return
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { error } = await supabase.functions.invoke('notify', { body })
    if (!error) return
    if (attempt === 3) console.warn(`Could not send ${what} notifications`, error)
    else await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
  }
}

/** Pings everyone (except the completer) about a completed chore. */
export const announceCompletion = (activityId: string) =>
  invokeNotify({ type: 'chore_completed', activity_id: activityId }, 'completion')

/** Pings everyone (except whoever checked it off) that a todo was completed. */
export const announceTodoDone = (todoId: string) =>
  invokeNotify({ type: 'todo_done', todo_id: todoId }, 'todo')

/** Pings only the person who was bumped. The request carries nothing about the sender. */
export const announceBump = (bumpId: string) => invokeNotify({ type: 'bump', bump_id: bumpId }, 'bump')
