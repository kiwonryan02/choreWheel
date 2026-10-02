import { beforeAll, describe, expect, test } from 'bun:test'
import { createDb, rejects } from './helpers'

let t: Awaited<ReturnType<typeof createDb>>
beforeAll(async () => {
  t = await createDb()
})

describe('seed', () => {
  test('both wheels start on Kiwon with their own rotation order', async () => {
    const chores = await t.rows(
      `select c.slug, m.name as current from chores c join members m on m.id = c.current_member_id order by c.slug`,
    )
    expect(chores).toEqual([
      { slug: 'dishes', current: 'Kiwon' },
      { slug: 'trash', current: 'Kiwon' },
    ])
    const rotations = await t.rows(`
      select c.slug, string_agg(m.name, ' > ' order by r.position) as rotation
        from chore_rotation r join chores c on c.id = r.chore_id join members m on m.id = r.member_id
       group by c.slug order by c.slug`)
    expect(rotations).toEqual([
      { slug: 'dishes', rotation: 'Kiwon > Lucas > Anish > Carter' },
      { slug: 'trash', rotation: 'Kiwon > Carter > Anish > Lucas' },
    ])
  })

  test('Realtime publishes chores, activity and todos only', async () => {
    const tables = await t.rows(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`)
    expect(tables.map((r) => r.tablename)).toEqual(['activity', 'chores', 'todos'])
  })
})

describe('the public (anon) key', () => {
  test.each(['members', 'chores', 'chore_rotation', 'activity'])('can read %s', async (table) => {
    expect(await rejects(t.as('anon', () => t.rows(`select 1 from ${table}`)))).toBe(false)
  })

  test.each(['bumps', 'push_subscriptions', 'household_settings', 'passcode_failures'])(
    'cannot read %s',
    async (table) => {
      expect(await rejects(t.as('anon', () => t.rows(`select 1 from ${table}`)))).toBe(true)
    },
  )

  test('cannot write chores, activity, or members directly', async () => {
    expect(await rejects(t.as('anon', () => t.rows(`update chores set updated_at = now()`)))).toBe(true)
    expect(await rejects(t.as('anon', () => t.rows(`insert into activity (kind, chore_id, member_id) select 'chore', chore_id, member_id from chore_rotation limit 1`)))).toBe(true)
    expect(await rejects(t.as('anon', () => t.rows(`delete from members`)))).toBe(true)
  })

  test('cannot call the passcode setup or internal check functions', async () => {
    expect(await rejects(t.as('anon', () => t.rows(`select set_household_passcode('1111')`)))).toBe(true)
    expect(await rejects(t.as('anon', () => t.rows(`select check_passcode('4821')`)))).toBe(true)
  })

  test('the old unauthenticated 2-argument complete_chore is gone', async () => {
    const id = await t.choreId('dishes')
    expect(await rejects(t.as('anon', () => t.rows(`select * from complete_chore($1, $2)`, [id, t.members.Kiwon])))).toBe(true)
  })
})

describe('the notify function (service_role)', () => {
  test('can read what it needs and prune subscriptions', async () => {
    await t.as('service_role', async () => {
      await t.rows('select 1 from activity')
      await t.rows('select 1 from chores')
      await t.rows('select 1 from members')
      await t.rows('select 1 from push_subscriptions')
      await t.rows(`delete from push_subscriptions where false`)
    })
  })

  test('cannot create completions itself', async () => {
    const chore = await t.choreId('dishes')
    expect(
      await rejects(
        t.as('service_role', () =>
          t.rows(`insert into activity (kind, chore_id, member_id) values ('chore', $1, $2)`, [chore, t.members.Kiwon]),
        ),
      ),
    ).toBe(true)
  })
})
