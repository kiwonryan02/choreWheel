import { beforeAll, describe, expect, test } from 'bun:test'
import { createDb, PASSCODE, rejects } from './helpers'

let t: Awaited<ReturnType<typeof createDb>>
let choreEntry: string
let todoEntry: string
let todoId: string
const ZERO = '00000000-0000-0000-0000-000000000000'

beforeAll(async () => {
  t = await createDb()
  // One chore entry and one todo entry to react to.
  const dishes = await t.choreId('dishes')
  choreEntry = (await t.as('anon', () => t.complete(PASSCODE, dishes, 'Kiwon'))).activity_id
  todoId = (await t.as('anon', () => t.one('select * from create_todo($1, $2, $3)', [PASSCODE, 'Buy paper towels', t.members.Kiwon]))).todo_id
  await t.as('anon', () => t.one('select * from set_todo_done($1, $2, $3, true)', [PASSCODE, todoId, t.members.Lucas]))
  todoEntry = (await t.one(`select id from activity where kind = 'todo'`)).id
})

const react = (entry: string, who: string, kind: string, on: boolean | null, pass: string | null = PASSCODE) =>
  t.as('anon', async () => (await t.one('select * from set_reaction($1, $2, $3, $4, $5)', [pass, entry, t.members[who], kind, on])).status)
const reactionsOn = (entry: string) =>
  t.rows('select member_id, kind from reactions where activity_id = $1 order by kind, member_id', [entry])

describe('set_reaction', () => {
  test('adds a reaction, and taking it back removes it', async () => {
    expect(await react(choreEntry, 'Lucas', 'thumbs_up', true)).toBe('ok')
    expect(await reactionsOn(choreEntry)).toEqual([{ member_id: t.members.Lucas, kind: 'thumbs_up' }])
    expect(await react(choreEntry, 'Lucas', 'thumbs_up', false)).toBe('ok')
    expect(await reactionsOn(choreEntry)).toEqual([])
  })

  test('is idempotent: repeating the same request changes nothing', async () => {
    expect(await react(choreEntry, 'Anish', 'heart', true)).toBe('ok')
    expect(await react(choreEntry, 'Anish', 'heart', true)).toBe('unchanged')
    expect(await reactionsOn(choreEntry)).toHaveLength(1)
    expect(await react(choreEntry, 'Anish', 'heart', false)).toBe('ok')
    expect(await react(choreEntry, 'Anish', 'heart', false)).toBe('unchanged')
  })

  test('works for all four reactions, on chore entries and todo entries', async () => {
    for (const kind of ['thumbs_up', 'heart', 'goat', 'thanks']) {
      expect(await react(choreEntry, 'Carter', kind, true)).toBe('ok')
      expect(await react(todoEntry, 'Carter', kind, true)).toBe('ok')
    }
    expect((await reactionsOn(choreEntry)).map((r) => r.kind)).toEqual(['goat', 'heart', 'thanks', 'thumbs_up'])
    expect(await reactionsOn(todoEntry)).toHaveLength(4)
  })

  test('different people can use the same reaction; the creator can react to their own entry', async () => {
    await react(todoEntry, 'Kiwon', 'goat', true) // Kiwon created the todo
    await react(todoEntry, 'Lucas', 'goat', true) // Lucas checked it off
    const goats = (await reactionsOn(todoEntry)).filter((r) => r.kind === 'goat')
    expect(goats.map((r) => r.member_id).sort()).toEqual([t.members.Carter, t.members.Kiwon, t.members.Lucas].sort())
  })

  test("one person's reaction does not affect another's", async () => {
    await react(choreEntry, 'Lucas', 'thanks', true)
    await react(choreEntry, 'Lucas', 'thanks', false)
    const thanks = (await reactionsOn(choreEntry)).filter((r) => r.kind === 'thanks')
    expect(thanks.map((r) => r.member_id)).toEqual([t.members.Carter]) // Carter's is still there
  })
})

describe('bad input', () => {
  test('unknown kind, unknown entry, unknown member, null flag, wrong passcode: nothing is stored', async () => {
    const before = (await t.one('select count(*)::int n from reactions')).n
    expect(await react(choreEntry, 'Lucas', 'thumbs_down', true)).toBe('bad_kind')
    expect(await react(choreEntry, 'Lucas', '', true)).toBe('bad_kind')
    expect(await react(ZERO, 'Lucas', 'heart', true)).toBe('not_found')
    expect(await t.as('anon', async () => (await t.one('select * from set_reaction($1,$2,$3,$4,$5)', [PASSCODE, choreEntry, ZERO, 'heart', true])).status)).toBe('unknown_member')
    expect(await react(choreEntry, 'Lucas', 'heart', null)).toBe('bad_request')
    expect(await react(choreEntry, 'Lucas', 'heart', true, '0000')).toBe('invalid')
    expect((await t.one('select count(*)::int n from reactions')).n).toBe(before)
  })

  test('the table itself rejects an unknown kind (backstop)', async () => {
    expect(
      await rejects(t.db.query(`insert into reactions (activity_id, member_id, kind) values ($1, $2, 'thumbs_down')`, [choreEntry, t.members.Kiwon])),
    ).toBe(true)
  })
})

describe('what happens to reactions', () => {
  test("unchecking a todo deletes its feed entry and the entry's reactions with it", async () => {
    const id = (await t.as('anon', () => t.one('select * from create_todo($1, $2, $3)', [PASSCODE, 'Short lived', t.members.Anish]))).todo_id
    await t.as('anon', () => t.one('select * from set_todo_done($1, $2, $3, true)', [PASSCODE, id, t.members.Carter]))
    const entry = (await t.one(`select id from activity where todo_id = $1`, [id])).id
    await react(entry, 'Kiwon', 'heart', true)
    await react(entry, 'Lucas', 'goat', true)
    expect(await reactionsOn(entry)).toHaveLength(2)

    await t.as('anon', () => t.one('select * from set_todo_done($1, $2, $3, false)', [PASSCODE, id, t.members.Carter]))
    expect(await reactionsOn(entry)).toEqual([])
    expect(await react(entry, 'Kiwon', 'heart', true)).toBe('not_found') // the entry is gone
  })
})

describe('access', () => {
  test('the public key can read reactions but not write them directly', async () => {
    expect(await rejects(t.as('anon', () => t.rows('select * from reactions')))).toBe(false)
    expect(await rejects(t.as('anon', () => t.rows(`insert into reactions (activity_id, member_id, kind) values ($1, $2, 'heart')`, [todoEntry, t.members.Anish])))).toBe(true)
    expect(await rejects(t.as('anon', () => t.rows('delete from reactions')))).toBe(true)
    expect(await rejects(t.as('anon', () => t.rows(`update reactions set kind = 'goat'`)))).toBe(true)
  })

  test('reactions are on the Realtime publication', async () => {
    const tables = await t.rows(`select tablename from pg_publication_tables where pubname = 'supabase_realtime'`)
    expect(tables.map((r) => r.tablename)).toContain('reactions')
  })
})
