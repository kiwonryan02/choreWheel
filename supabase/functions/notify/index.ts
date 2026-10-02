// notify: sends Web Push notifications.
//
// Two request types, both called by the app right after the matching RPC (todos send none, by design):
//   { type: 'chore_completed', activity_id }  after complete_chore
//   { type: 'bump',            bump_id }      after bump_chore
//
// Each call CLAIMS its row (sets notified_at, only if still null and recent),
// so however often it is called, each completion or bump notifies at most
// once. That is what makes it safe to leave this function callable with the
// public key: it can't be used to spam anyone.
//
// ANONYMITY: a bump request carries only the bump's id. Nothing about who sent
// it exists anywhere (not in the request, the table, or the notification), and
// this function must never log or store anything that could identify them.
//
// Deploy with "Verify JWT" OFF: the app authenticates with a publishable key,
// which isn't a JWT. See docs/PUSH_SETUP.md.
//
// Secrets (Edge Functions -> Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided.

import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { buildBumpMessage, buildCompletedMessage, type PushMessage } from './message.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Only events this recent can be announced; older ones are never replayed.
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

const isId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)
const claimCutoff = () => new Date(Date.now() - MAX_AGE_MS).toISOString()

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  let body: { type?: unknown; activity_id?: unknown; bump_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid json' }, 400)
  }

  try {
    if (body.type === 'chore_completed' && isId(body.activity_id)) {
      return await choreCompleted(body.activity_id)
    }
    if (body.type === 'bump' && isId(body.bump_id)) {
      return await bumped(body.bump_id)
    }
  } catch (err) {
    console.error('notify failed', err)
    return json({ error: 'internal error' }, 500)
  }
  return json({ error: 'unknown request' }, 400)
})

// TODO(todo push, deliberately NOT built in v1): todos have no push notifications, only
// live in-app updates and the feed. If wanted later ("Alex checked off 'Buy paper towels'"),
// add a 'todo_done' request type next to the two below that claims an activity row with
// kind = 'todo' the same way, builds its message in message.ts, and sends to everyone except
// the person who checked it off. The app would call it right after set_todo_done.
async function choreCompleted(activityId: string): Promise<Response> {
  // Claim the completion. The null check makes this a once-only operation.
  const { data: activity, error: claimError } = await db
    .from('activity')
    .update({ notified_at: new Date().toISOString() })
    .eq('id', activityId)
    .eq('kind', 'chore') // todo entries are never announced (see the TODO above)
    .is('notified_at', null)
    .gte('created_at', claimCutoff())
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

  return json(
    await sendAll(
      subscriptions,
      buildCompletedMessage({
        choreSlug: chore.slug,
        choreName: chore.name,
        completerName: nameOf(activity.member_id),
        nextName: nameOf(chore.current_member_id),
      }),
    ),
  )
}

async function bumped(bumpId: string): Promise<Response> {
  // The database decides who may be pinged (see claim_bump_notification): the
  // bump is claimed exactly once, and the recipient is returned only if they
  // are STILL the person on the chore. If the wheel moved on, nobody is pinged.
  const { data, error: claimError } = await db.rpc('claim_bump_notification', { p_bump_id: bumpId })
  if (claimError) throw claimError
  const claim = (data as { chore_slug: string; chore_name: string; recipient_id: string }[] | null)?.[0]
  if (!claim) return json({ sent: 0, reason: 'already announced, too old, unknown, or the chore moved on' })

  // Only that one person's devices.
  const { data: subscriptions, error: subsError } = await db
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('member_id', claim.recipient_id)
  if (subsError) throw subsError

  return json(
    await sendAll(subscriptions, buildBumpMessage({ choreSlug: claim.chore_slug, choreName: claim.chore_name })),
  )
}

interface Subscription {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

async function sendAll(subscriptions: Subscription[], message: PushMessage) {
  const payload = JSON.stringify(message)
  const outcomes = await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
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
        console.error('push failed', status)
        return 'failed'
      }
    }),
  )
  const count = (kind: string) => outcomes.filter((o) => o === kind).length
  return { sent: count('sent'), pruned: count('pruned'), failed: count('failed') }
}
