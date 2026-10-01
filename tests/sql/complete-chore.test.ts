import { beforeAll, describe, expect, test } from 'bun:test'
import { createDb, PASSCODE } from './helpers'

let t: Awaited<ReturnType<typeof createDb>>
let dishes: string
let trash: string
beforeAll(async () => {
  t = await createDb()
  dishes = await t.choreId('dishes')
  trash = await t.choreId('trash')
  await t.db.exec('set role anon') // everything below runs as the public key
})

// Tests in this file build on each other: the state carries forward.
describe('complete_chore', () => {
  test('advances Dishes Kiwon -> Lucas and writes one activity row', async () => {
    const r = await t.complete(PASSCODE, dishes, 'Kiwon')
    expect(r.status).toBe('done')
    expect(t.nameOf(r.up_now)).toBe('Lucas')
    expect(r.activity_id).toBeTruthy()
    const rows = await t.rows('select id, member_id from activity')
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(r.activity_id)
    expect(rows[0].member_id).toBe(t.members.Kiwon)
  })

  test('a second call from the same state is stale and changes nothing', async () => {
    const r = await t.complete(PASSCODE, dishes, 'Kiwon')
    expect(r.status).toBe('stale')
    expect(t.nameOf(r.up_now)).toBe('Lucas')
    expect(r.activity_id).toBeNull()
    expect(await t.rows('select 1 from activity')).toHaveLength(1)
  })

  test('someone who is not on top gets stale, not an advance', async () => {
    const r = await t.complete(PASSCODE, dishes, 'Anish')
    expect(r.status).toBe('stale')
    expect(t.nameOf(r.up_now)).toBe('Lucas')
  })

  test('walks the whole rotation and wraps Carter -> Kiwon', async () => {
    expect(t.nameOf((await t.complete(PASSCODE, dishes, 'Lucas')).up_now)).toBe('Anish')
    expect(t.nameOf((await t.complete(PASSCODE, dishes, 'Anish')).up_now)).toBe('Carter')
    expect(t.nameOf((await t.complete(PASSCODE, dishes, 'Carter')).up_now)).toBe('Kiwon')
  })

  test('Trash advances independently and in its own (reversed) order', async () => {
    expect(t.nameOf((await t.complete(PASSCODE, trash, 'Kiwon')).up_now)).toBe('Carter')
    const current = await t.rows(`select c.slug, c.current_member_id from chores c order by slug`)
    expect(t.nameOf(current[0].current_member_id)).toBe('Kiwon') // dishes
    expect(t.nameOf(current[1].current_member_id)).toBe('Carter') // trash
  })

  test('an unknown chore or member is reported as stale, not an error', async () => {
    const r = await t.one(`select * from complete_chore($1, $2, $3)`, [PASSCODE, trash, '00000000-0000-0000-0000-000000000000'])
    expect(r.status).toBe('stale')
  })
})
