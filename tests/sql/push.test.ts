import { beforeAll, describe, expect, test } from 'bun:test'
import { createDb, PASSCODE } from './helpers'

let t: Awaited<ReturnType<typeof createDb>>
beforeAll(async () => {
  t = await createDb()
})

const save = (pass: string | null, member: string, endpoint = 'https://push.example/abc', p256dh = 'pk', auth = 'au') =>
  t.as('anon', async () =>
    (await t.one('select save_push_subscription($1, $2, $3, $4, $5) s', [pass, member, endpoint, p256dh, auth])).s,
  )
const subs = () => t.as('service_role', () => t.rows('select member_id, endpoint, p256dh, auth from push_subscriptions order by endpoint'))

describe('save_push_subscription', () => {
  test('stores a subscription for a member', async () => {
    expect(await save(PASSCODE, t.members.Kiwon)).toBe('ok')
    expect(await subs()).toEqual([{ member_id: t.members.Kiwon, endpoint: 'https://push.example/abc', p256dh: 'pk', auth: 'au' }])
  })

  test('saving the same device again moves it to the new person instead of duplicating', async () => {
    expect(await save(PASSCODE, t.members.Lucas, 'https://push.example/abc', 'pk2', 'au2')).toBe('ok')
    expect(await subs()).toEqual([{ member_id: t.members.Lucas, endpoint: 'https://push.example/abc', p256dh: 'pk2', auth: 'au2' }])
  })

  test('a wrong passcode is refused and stores nothing', async () => {
    expect(await save('0000', t.members.Anish, 'https://push.example/other')).toBe('invalid')
    expect(await subs()).toHaveLength(1)
  })

  test('rejects unknown members and malformed subscriptions', async () => {
    expect(await save(PASSCODE, '00000000-0000-0000-0000-000000000000', 'https://push.example/x')).toBe('unknown_member')
    expect(await save(PASSCODE, t.members.Anish, 'http://insecure.example/x')).toBe('bad_subscription')
    expect(await save(PASSCODE, t.members.Anish, 'https://push.example/x', '', 'au')).toBe('bad_subscription')
    expect(await subs()).toHaveLength(1)
  })

  test('the public key cannot read subscriptions', async () => {
    await expect(t.as('anon', () => t.rows('select * from push_subscriptions'))).rejects.toThrow()
  })
})

describe('announcing a completion (what the notify function does)', () => {
  test('the claim succeeds exactly once per activity row', async () => {
    await save(PASSCODE, t.members.Anish, 'https://push.example/anish')
    const chore = await t.choreId('dishes')
    const done = await t.as('anon', () => t.complete(PASSCODE, chore, 'Kiwon'))
    expect(done.activity_id).toBeTruthy()

    const claim = () =>
      t.as('service_role', () =>
        t.rows(
          `update activity set notified_at = now()
            where id = $1 and notified_at is null and created_at >= now() - interval '2 minutes'
            returning chore_id, member_id`,
          [done.activity_id],
        ),
      )
    expect(await claim()).toHaveLength(1)
    expect(await claim()).toHaveLength(0)
  })

  test('old completions are never announced', async () => {
    const chore = await t.choreId('trash')
    const done = await t.as('anon', () => t.complete(PASSCODE, chore, 'Kiwon'))
    await t.db.query(`update activity set created_at = now() - interval '10 minutes' where id = $1`, [done.activity_id])
    const claimed = await t.as('service_role', () =>
      t.rows(
        `update activity set notified_at = now()
          where id = $1 and notified_at is null and created_at >= now() - interval '2 minutes' returning id`,
        [done.activity_id],
      ),
    )
    expect(claimed).toHaveLength(0)
  })

  test("the completer's own devices are excluded from the recipients", async () => {
    await save(PASSCODE, t.members.Kiwon, 'https://push.example/kiwon-phone')
    const recipients = await t.as('service_role', () =>
      t.rows(`select endpoint from push_subscriptions where member_id <> $1 order by endpoint`, [t.members.Kiwon]),
    )
    expect(recipients.map((r) => r.endpoint)).not.toContain('https://push.example/kiwon-phone')
    expect(recipients.map((r) => r.endpoint)).toContain('https://push.example/anish')
  })
})
