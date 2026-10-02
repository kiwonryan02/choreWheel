import { beforeAll, describe, expect, test } from 'bun:test'
import { createDb, PASSCODE, rejects } from './helpers'

let t: Awaited<ReturnType<typeof createDb>>
beforeAll(async () => {
  t = await createDb()
})

const ZERO = '00000000-0000-0000-0000-000000000000'
const create = (text: string | null, who = 'Kiwon', pass: string | null = PASSCODE) =>
  t.as('anon', () => t.one('select * from create_todo($1, $2, $3)', [pass, text, t.members[who]]))
const setDone = (todo: string, who: string, done: boolean | null, pass: string | null = PASSCODE) =>
  t.as('anon', async () => (await t.one('select * from set_todo_done($1, $2, $3, $4)', [pass, todo, t.members[who], done])).status)
const remove = (todo: string, who: string, pass: string | null = PASSCODE) =>
  t.as('anon', async () => (await t.one('select * from delete_todo($1, $2, $3)', [pass, todo, t.members[who]])).status)
const todoRow = (id: string) => t.one('select * from todos where id = $1', [id])
const feedFor = (id: string) => t.rows(`select * from activity where kind = 'todo' and todo_id = $1`, [id])

describe('create_todo', () => {
  test('stores the todo, trimmed, attributed to its creator, and logs nothing', async () => {
    const r = await create('  Buy paper towels \n')
    expect(r.status).toBe('ok')
    const row = await todoRow(r.todo_id)
    expect(row.text).toBe('Buy paper towels')
    expect(row.created_by).toBe(t.members.Kiwon)
    expect(row.done).toBe(false)
    expect(row.completed_by).toBeNull()
    expect(await feedFor(r.todo_id)).toEqual([]) // creation is not logged
  })

  test.each(['', '   ', '\n\t  \n'])('rejects empty / whitespace-only text %p', async (text) => {
    expect((await create(text)).status).toBe('empty')
    expect((await create(null)).status).toBe('empty')
  })

  test('allows exactly 200 characters, rejects 201; spaces around the text do not count', async () => {
    expect((await create('x'.repeat(200))).status).toBe('ok')
    expect((await create(`   ${'y'.repeat(200)}   `)).status).toBe('ok')
    expect((await create('z'.repeat(201))).status).toBe('too_long')
  })

  test('rejects an unknown member and a wrong passcode, and creates nothing', async () => {
    const before = (await t.one('select count(*)::int n from todos')).n
    const unknown = await t.as('anon', () => t.one('select * from create_todo($1, $2, $3)', [PASSCODE, 'hi', ZERO]))
    expect(unknown.status).toBe('unknown_member')
    expect((await create('hi', 'Kiwon', '0000')).status).toBe('invalid')
    expect((await t.one('select count(*)::int n from todos')).n).toBe(before)
  })

  test('the table itself also refuses empty and over-long text (backstop)', async () => {
    const insert = (text: string) => rejects(t.db.query('insert into todos (text, created_by) values ($1, $2)', [text, t.members.Kiwon]))
    expect(await insert('')).toBe(true)
    expect(await insert('   ')).toBe(true)
    expect(await insert('x'.repeat(201))).toBe(true)
  })
})

describe('set_todo_done: checking off', () => {
  test('anyone can check any todo; it records who and when, and writes exactly one feed entry', async () => {
    const { todo_id } = await create('Take out recycling', 'Kiwon')
    expect(await setDone(todo_id, 'Lucas', true)).toBe('ok') // not the creator
    const row = await todoRow(todo_id)
    expect(row.done).toBe(true)
    expect(row.completed_by).toBe(t.members.Lucas)
    expect(row.completed_at).toBeInstanceOf(Date)
    const feed = await feedFor(todo_id)
    expect(feed).toHaveLength(1)
    expect(feed[0].member_id).toBe(t.members.Lucas)
    expect(feed[0].chore_id).toBeNull()
    expect(feed[0].created_at.getTime()).toBe(row.completed_at.getTime())
  })

  test('is idempotent: a second check-off (e.g. two phones at once) changes nothing and adds no entry', async () => {
    const { todo_id } = await create('Wipe counters')
    expect(await setDone(todo_id, 'Anish', true)).toBe('ok')
    expect(await setDone(todo_id, 'Carter', true)).toBe('unchanged')
    expect(await setDone(todo_id, 'Anish', true)).toBe('unchanged')
    const feed = await feedFor(todo_id)
    expect(feed).toHaveLength(1)
    expect(feed[0].member_id).toBe(t.members.Anish) // whoever got there first
    expect((await todoRow(todo_id)).completed_by).toBe(t.members.Anish)
  })
})

describe('set_todo_done: unchecking', () => {
  test('anyone can uncheck; the todo reopens and its feed entry is deleted', async () => {
    const { todo_id } = await create('Fix the lamp')
    await setDone(todo_id, 'Lucas', true)
    expect(await feedFor(todo_id)).toHaveLength(1)
    expect(await setDone(todo_id, 'Carter', false)).toBe('ok') // a different person than the checker
    const row = await todoRow(todo_id)
    expect(row.done).toBe(false)
    expect(row.completed_by).toBeNull()
    expect(row.completed_at).toBeNull()
    expect(await feedFor(todo_id)).toEqual([])
  })

  test('unchecking an open todo is a no-op', async () => {
    const { todo_id } = await create('Water plants')
    expect(await setDone(todo_id, 'Kiwon', false)).toBe('unchanged')
  })

  test('check, uncheck, check again leaves exactly one entry', async () => {
    const { todo_id } = await create('Vacuum')
    await setDone(todo_id, 'Lucas', true)
    await setDone(todo_id, 'Lucas', false)
    await setDone(todo_id, 'Anish', true)
    const feed = await feedFor(todo_id)
    expect(feed).toHaveLength(1)
    expect(feed[0].member_id).toBe(t.members.Anish)
  })

  test("unchecking a todo never touches other todos' or chores' feed entries", async () => {
    const keep = await create('Keep me')
    await setDone(keep.todo_id, 'Kiwon', true)
    const chore = await t.choreId('dishes')
    await t.as('anon', () => t.complete(PASSCODE, chore, 'Kiwon'))
    const gone = await create('Undo me')
    await setDone(gone.todo_id, 'Lucas', true)
    await setDone(gone.todo_id, 'Lucas', false)
    expect(await feedFor(keep.todo_id)).toHaveLength(1)
    expect((await t.rows(`select 1 from activity where kind = 'chore'`)).length).toBeGreaterThanOrEqual(1)
  })
})

describe('set_todo_done: bad input', () => {
  test('unknown todo, unknown member, null flag, wrong passcode', async () => {
    const { todo_id } = await create('Edge cases')
    expect(await setDone(ZERO, 'Kiwon', true)).toBe('not_found')
    expect(await t.as('anon', async () => (await t.one('select * from set_todo_done($1,$2,$3,$4)', [PASSCODE, todo_id, ZERO, true])).status)).toBe('unknown_member')
    expect(await setDone(todo_id, 'Kiwon', null)).toBe('bad_request')
    expect(await setDone(todo_id, 'Kiwon', true, '0000')).toBe('invalid')
    expect((await todoRow(todo_id)).done).toBe(false)
    expect(await feedFor(todo_id)).toEqual([])
  })
})

describe('delete_todo', () => {
  test('the creator can delete their own open todo', async () => {
    const { todo_id } = await create('Delete me', 'Kiwon')
    expect(await remove(todo_id, 'Kiwon')).toBe('ok')
    expect(await t.rows('select 1 from todos where id = $1', [todo_id])).toEqual([])
  })

  test('nobody else can, even though they can check it off', async () => {
    const { todo_id } = await create('Not yours', 'Kiwon')
    expect(await remove(todo_id, 'Lucas')).toBe('not_creator')
    expect(await todoRow(todo_id)).toBeTruthy()
  })

  test('not once it is done, even by the creator; fine again after an uncheck', async () => {
    const { todo_id } = await create('Done then deleted', 'Kiwon')
    await setDone(todo_id, 'Lucas', true)
    expect(await remove(todo_id, 'Kiwon')).toBe('already_done')
    await setDone(todo_id, 'Lucas', false)
    expect(await remove(todo_id, 'Kiwon')).toBe('ok')
  })

  test('unknown todo and wrong passcode', async () => {
    expect(await remove(ZERO, 'Kiwon')).toBe('not_found')
    const { todo_id } = await create('Wrong passcode', 'Kiwon')
    expect(await remove(todo_id, 'Kiwon', '0000')).toBe('invalid')
    expect(await todoRow(todo_id)).toBeTruthy()
  })

  test("deleting a todo directly takes its feed entries with it (cascade)", async () => {
    const { todo_id } = await create('Cascade', 'Kiwon')
    await setDone(todo_id, 'Lucas', true)
    await t.db.query('delete from todos where id = $1', [todo_id])
    expect(await feedFor(todo_id)).toEqual([])
  })
})

describe('the public key and the feed', () => {
  test('can read todos but not write them directly', async () => {
    expect(await rejects(t.as('anon', () => t.rows('select * from todos')))).toBe(false)
    expect(await rejects(t.as('anon', () => t.rows(`insert into todos (text, created_by) values ('x', $1)`, [t.members.Kiwon])))).toBe(true)
    expect(await rejects(t.as('anon', () => t.rows(`update todos set text = 'y'`)))).toBe(true)
    expect(await rejects(t.as('anon', () => t.rows(`delete from todos`)))).toBe(true)
  })

  test('the feed interleaves chores and todos in time order, each with one subject', async () => {
    await t.db.exec('delete from activity')
    const chore = await t.choreId('trash')
    const a = await create('First thing')
    await setDone(a.todo_id, 'Lucas', true)
    await t.as('anon', () => t.complete(PASSCODE, chore, 'Kiwon'))
    const b = await create('Third thing')
    await setDone(b.todo_id, 'Carter', true)
    // Same-transaction timestamps can tie in a test; order by id as the tiebreak.
    const feed = await t.as('anon', () => t.rows(`select kind, chore_id, todo_id from activity order by created_at, id`))
    expect(feed.map((f) => f.kind).sort()).toEqual(['chore', 'todo', 'todo'])
    for (const f of feed) expect((f.chore_id === null) !== (f.todo_id === null)).toBe(true)
  })

  test('todos are on the Realtime publication', async () => {
    const tables = await t.rows(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`)
    expect(tables.map((r) => r.tablename)).toContain('todos')
  })
})
