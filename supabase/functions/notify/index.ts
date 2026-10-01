// notify: sends Web Push notifications when a chore is completed.
//
// Called by the app right after a successful complete_chore, with the new
// activity row's id. The function CLAIMS that row (sets notified_at, only if
// still null and recent), so however often it is called, each completion
// notifies at most once. That is what makes it safe to leave this function
// callable with the public key: it can't be used to spam anyone.
//
// Deploy with "Verify JWT" OFF: the app authenticates with a publishable key,
// which isn't a JWT. See docs/PUSH_SETUP.md.
//
// Secrets (Edge Functions -> Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided.

import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { buildCompletedMessage } from './message.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Only completions this recent can be announced; older ones are never replayed.
const MAX_AGE_MS = 2 * 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function requireEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing secret ${name}. See docs/PUSH_SETUP.md.`)
  return value
}

webpush.setVapidDetails(
  requireEnv('VAPID_SUBJECT'),
  requireEnv('VAPID_PUBLIC_KEY'),
  requireEnv('VAPID_PRIVATE_KEY'),
)
const db = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'))

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  let body: { type?: unknown; activity_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid json' }, 400)
  }

  if (
    body.type === 'chore_completed' &&
    typeof body.activity_id === 'string' &&
    UUID.test(body.activity_id)
  ) {
    try {
      return await choreCompleted(body.activity_id)
    } catch (err) {
      console.error('chore_completed failed', err)
      return json({ error: 'internal error' }, 500)
    }
  }
  return json({ error: 'unknown request' }, 400)
})

async function choreCompleted(activityId: string): Promise<Response> {
  // Claim the completion. The null check makes this a once-only operation.
  const cutoff = new Date(Date.now() - MAX_AGE_MS).toISOString()
  const { data: activity, error: claimError } = await db
    .from('activity')
    .update({ notified_at: new Date().toISOString() })
    .eq('id', activityId)
    .is('notified_at', null)
    .gte('completed_at', cutoff)
    .select('chore_id, member_id')
    .maybeSingle()
  if (claimError) throw claimError
  if (!activity) return json({ sent: 0, reason: 'already announced, too old, or unknown' })

  const { data: chore, error: choreError } = await db
    .from('chores')
    .select('slug, name, current_member_id')
    .eq('id', activity.chore_id)
    .single()
  if (choreError) throw choreError

  const { data: people, error: peopleError } = await db
    .from('members')
    .select('id, name')
    .in('id', [activity.member_id, chore.current_member_id])
  if (peopleError) throw peopleError
  const nameOf = (id: string) => people.find((m) => m.id === id)?.name ?? 'Someone'

  // Everyone except the person who just did it (and their other devices).
  const { data: subscriptions, error: subsError } = await db
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .neq('member_id', activity.member_id)
  if (subsError) throw subsError

  const message = JSON.stringify(
    buildCompletedMessage({
      choreSlug: chore.slug,
      choreName: chore.name,
      completerName: nameOf(activity.member_id),
      nextName: nameOf(chore.current_member_id),
    }),
  )

  const outcomes = await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          message,
          { TTL: 60 * 60 },
        )
        return 'sent'
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          // The device uninstalled or revoked permission: forget it.
          await db.from('push_subscriptions').delete().eq('id', sub.id)
          return 'pruned'
        }
        console.error('push failed', status, err)
        return 'failed'
      }
    }),
  )

  const count = (kind: string) => outcomes.filter((o) => o === kind).length
  return json({ sent: count('sent'), pruned: count('pruned'), failed: count('failed') })
}
