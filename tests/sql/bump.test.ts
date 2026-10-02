import { beforeAll, describe, expect, test } from 'bun:test'
import { createDb, PASSCODE } from './helpers'

let t: Awaited<ReturnType<typeof createDb>>
let dishes: string
let trash: string
beforeAll(async () => {
  t = await createDb()
  dishes = await t.choreId('dishes')
  trash = await t.choreId('trash')
})

const bump = (pass: string | null, chore: string, target: string) =>
  t.as('anon', () => t.one('select * from bump_chore($1, $2, $3)', [pass, chore, t.members[target]]))
const bumpRows = () => t.rows('select * from bumps order by created_at')
// Pretend time has passed: the 6 hour window is measured from created_at.
const age = (interval: string) => t.db.exec(`update bumps set created_at = created_at - interval '${interval}'`)

describe('anonymity', () => {
  test('bumps has no column that could identify a sender', async () => {
    const columns = (await t.rows(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'bumps' order by 1`,
    )).map((c) => c.column_name)
    // If you are adding a column to this list, make sure it cannot identify who bumped.
    expect(columns).toEqual(['chore_id', 'created_at', 'id', 'notified_at', 'target_member_id'])
  })

  test('bump_chore takes no argument that could identify a sender', async () => {
    const args = await t.one(
      `select pg_get_function_identity_arguments(p.oid) as args from pg_proc p where p.proname = 'bump_chore'`,
    )
    expect(args.args).toBe('p_passcode text, p_chore_id uuid, p_expected_member_id uuid')
  })

  test('the public key cannot read bumps', async () => {
    await expect(t.as('anon', () => t.rows('select * from bumps'))).rejects.toThrow()
  })
})

describe('bump_chore', () => {
  test('records a bump aimed at the person on top, and only that', async () => {
    const r = await bump(PASSCODE, dishes, 'Kiwon')
    expect(r.status).toBe('sent')
    expect(r.bump_id).toBeTruthy()
    const rows = await bumpRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(r.bump_id)
    expect(rows[0].chore_id).toBe(dishes)
    expect(rows[0].target_member_id).toBe(t.members.Kiwon)
    expect(rows[0].notified_at).toBeNull()
  })

  test('a second bump on the same chore inside 6 hours is rate limited and records nothing', async () => {
    const r = await bump(PASSCODE, dishes, 'Kiwon')
    expect(r.status).toBe('rate_limited')
    expect(r.bump_id).toBeNull()
    expect(await bumpRows()).toHaveLength(1)
  })

  test('the limit is per chore: Trash can still be bumped', async () => {
    expect((await bump(PASSCODE, trash, 'Kiwon')).status).toBe('sent')
  })

  test('still limited at 5h59m, allowed again after 6 hours', async () => {
    await age('5 hours 59 minutes')
    expect((await bump(PASSCODE, dishes, 'Kiwon')).status).toBe('rate_limited')
    await age('2 minutes')
    expect((await bump(PASSCODE, dishes, 'Kiwon')).status).toBe('sent')
  })

  test('a bump aimed at someone who is not on top is stale and records nothing', async () => {
    const before = (await bumpRows()).length
    const r = await bump(PASSCODE, dishes, 'Lucas')
    expect(r.status).toBe('stale')
    expect((await bumpRows()).length).toBe(before)
  })

  test('a wrong passcode is refused and records nothing', async () => {
    await age('7 hours') // so only the passcode could be the reason
    const before = (await bumpRows()).length
    expect((await bump('0000', dishes, 'Kiwon')).status).toBe('invalid')
    expect((await bumpRows()).length).toBe(before)
  })
})

describe('get_nudges (the in-app "you were nudged" banner)', () => {
  const nudges = (member: string) =>
    t.as('anon', () => t.rows('select * from get_nudges($1, $2)', [PASSCODE, t.members[member]]))

  test('reports a recent bump to the person it was aimed at, and nobody else', async () => {
    await t.db.exec('delete from bumps')
    await bump(PASSCODE, dishes, 'Kiwon')
    const mine = await nudges('Kiwon')
    expect(mine).toHaveLength(1)
    expect(mine[0].status).toBe('ok')
    expect(mine[0].chore_id).toBe(dishes)
    expect(await nudges('Lucas')).toEqual([])
  })

  test('stops reporting once the wheel moves on (the nudge belonged to that stint)', async () => {
    await t.as('anon', () => t.complete(PASSCODE, dishes, 'Kiwon'))
    expect(await nudges('Kiwon')).toEqual([])
    expect(await nudges('Lucas')).toEqual([]) // Lucas was never bumped
  })

  test('does not report nudges older than 6 hours', async () => {
    await t.db.exec('delete from bumps')
    await bump(PASSCODE, trash, 'Kiwon')
    await age('7 hours')
    expect(await nudges('Kiwon')).toEqual([])
  })

  test('a wrong passcode gets a status row, not data', async () => {
    const rows = await t.as('anon', () => t.rows('select * from get_nudges($1, $2)', ['0000', t.members.Kiwon]))
    expect(rows).toEqual([{ status: 'invalid', chore_id: null, nudged_at: null }])
  })
})

describe('announcing a bump (what the notify function does)', () => {
  test('the claim succeeds once, and only for recent bumps', async () => {
    await t.db.exec('delete from bumps')
    const chore = await t.choreId('trash')
    const sent = await bump(PASSCODE, chore, 'Kiwon')
    const claim = () =>
      t.as('service_role', () =>
        t.rows(
          `update bumps set notified_at = now()
            where id = $1 and notified_at is null and created_at >= now() - interval '2 minutes'
            returning chore_id, target_member_id`,
          [sent.bump_id],
        ),
      )
    const first = await claim()
    expect(first).toHaveLength(1)
    expect(first[0].target_member_id).toBe(t.members.Kiwon)
    expect(await claim()).toHaveLength(0)
  })
})
