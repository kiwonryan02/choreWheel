import { beforeAll, describe, expect, test } from 'bun:test'
import { createDb, PASSCODE, rejects } from './helpers'

// Last migration before the activity generalization.
const BEFORE = '20261001000400'

let t: Awaited<ReturnType<typeof createDb>>
let history: { id: string; chore_id: string; member_id: string; completed_at: Date }[]

beforeAll(async () => {
  t = await createDb({ stopAfter: BEFORE })
  const dishes = await t.choreId('dishes')
  const trash = await t.choreId('trash')
  // Real chore history, written by the OLD complete_chore into the OLD schema.
  await t.as('anon', async () => {
    await t.complete(PASSCODE, dishes, 'Kiwon')
    await t.complete(PASSCODE, dishes, 'Lucas')
    await t.complete(PASSCODE, trash, 'Kiwon')
  })
  history = await t.rows('select id, chore_id, member_id, completed_at from activity order by completed_at, id')
  await t.migrateRest()
})

describe('migrating existing activity history', () => {
  test('the old schema really had completed_at and no kind (sanity check)', () => {
    expect(history).toHaveLength(3)
    expect(history[0].completed_at).toBeInstanceOf(Date)
  })

  test('every old row survives, as kind = chore, keeping its id, chore, member and timestamp', async () => {
    const after = await t.rows('select id, kind, chore_id, todo_id, member_id, created_at from activity order by created_at, id')
    expect(after).toHaveLength(history.length)
    after.forEach((row, i) => {
      expect(row.id).toBe(history[i].id)
      expect(row.kind).toBe('chore')
      expect(row.chore_id).toBe(history[i].chore_id)
      expect(row.todo_id).toBeNull()
      expect(row.member_id).toBe(history[i].member_id)
      expect(row.created_at.getTime()).toBe(history[i].completed_at.getTime())
    })
  })

  test('the old column name is gone', async () => {
    expect(await rejects(t.rows('select completed_at from activity'))).toBe(true)
  })

  test('the new complete_chore still works and writes a chore entry', async () => {
    const dishes = await t.choreId('dishes')
    const r = await t.as('anon', () => t.complete(PASSCODE, dishes, 'Anish'))
    expect(r.status).toBe('done')
    const row = await t.one('select kind, chore_id, todo_id, created_at from activity where id = $1', [r.activity_id])
    expect(row.kind).toBe('chore')
    expect(row.chore_id).toBe(dishes)
    expect(row.todo_id).toBeNull()
  })

  test('the feed can still be read by the public key, newest first', async () => {
    const rows = await t.as('anon', () => t.rows('select id from activity order by created_at desc'))
    expect(rows).toHaveLength(history.length + 1)
  })
})

describe('the activity constraints', () => {
  const insert = (sql: string, params: unknown[] = []) => rejects(t.db.query(sql, params))

  test('a chore entry must have a chore and no todo', async () => {
    expect(await insert(`insert into activity (kind, member_id) values ('chore', $1)`, [t.members.Kiwon])).toBe(true)
    expect(
      await insert(`insert into activity (kind, chore_id, todo_id, member_id) values ('chore', $1, gen_random_uuid(), $2)`, [await t.choreId('dishes'), t.members.Kiwon]),
    ).toBe(true)
  })

  test('a todo entry must have a todo and no chore', async () => {
    expect(await insert(`insert into activity (kind, member_id) values ('todo', $1)`, [t.members.Kiwon])).toBe(true)
    expect(
      await insert(`insert into activity (kind, chore_id, todo_id, member_id) values ('todo', $1, gen_random_uuid(), $2)`, [await t.choreId('dishes'), t.members.Kiwon]),
    ).toBe(true)
  })

  test('kind must be chore or todo', async () => {
    expect(await insert(`insert into activity (kind, chore_id, member_id) values ('bump', $1, $2)`, [await t.choreId('dishes'), t.members.Kiwon])).toBe(true)
  })
})
