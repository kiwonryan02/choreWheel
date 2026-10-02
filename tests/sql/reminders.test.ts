import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createDb, PASSCODE, rejects } from './helpers'

// pg_net and pg_cron don't exist in the test database. The reminder logic does not
// need them: only the HTTP call does, and this stub records what would be sent.
const NET_STUB = `
  create schema net;
  create table net._calls (id serial primary key, url text, body jsonb);
  create function net.http_post(
    url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
    headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000
  ) returns bigint language sql as $$
    insert into net._calls (url, body) values (url, body) returning id::bigint
  $$;
`
const URL = 'https://example-ref.supabase.co/functions/v1/notify'
const NOON = '2026-10-05T12:00:00-04:00' // 12:00 in America/New_York (EDT)
const at = (hhmm: string) => `2026-10-05T${hhmm}:00-04:00`

let t: Awaited<ReturnType<typeof createDb>>
beforeAll(async () => {
  t = await createDb()
  await t.db.exec(NET_STUB)
})

// Each test starts from: configured, both chores fresh, no reminders, no recorded calls.
async function reset(configured = true) {
  await t.db.exec(`delete from chore_reminders; delete from app_settings; delete from net._calls;`)
  if (configured) await t.db.query('select configure_reminders($1, $2)', [URL, 'America/New_York'])
  await t.db.query(`update chores set updated_at = $1::timestamptz - interval '1 hour'`, [NOON])
}
const age = (slug: string, interval: string) =>
  t.db.query(`update chores set updated_at = $1::timestamptz - $2::interval where slug = $3`, [NOON, interval, slug])
const run = async (now = NOON) => (await t.one('select send_stale_chore_reminders($1::timestamptz) n', [now])).n as number
const reminders = () => t.rows('select * from chore_reminders order by created_at')
const calls = () => t.rows('select url, body from net._calls order by id')
const claim = (id: string, now = NOON) =>
  t.as('service_role', () => t.rows('select * from claim_reminder_notification($1, $2::timestamptz)', [id, now]))

beforeEach(() => reset())

describe('configuring (run by hand in the SQL editor)', () => {
  test('rejects a non-https url and an unknown timezone, and the public key cannot call it', async () => {
    expect(await rejects(t.db.query(`select configure_reminders('http://insecure.example', 'America/New_York')`))).toBe(true)
    expect(await rejects(t.db.query(`select configure_reminders($1, 'Mars/Olympus')`, [URL]))).toBe(true)
    expect(await rejects(t.as('anon', () => t.rows(`select configure_reminders($1, 'America/New_York')`, [URL])))).toBe(true)
  })

  test('re-running it updates the settings', async () => {
    await t.db.query('select configure_reminders($1, $2)', [URL, 'America/Los_Angeles'])
    const tz = await t.one(`select value from app_settings where key = 'reminder_timezone'`)
    expect(tz.value).toBe('America/Los_Angeles')
  })
})

describe('when it is not configured', () => {
  test('nothing is sent and nothing is recorded, so nothing is lost', async () => {
    await reset(false)
    await age('dishes', '10 days')
    expect(await run()).toBe(0)
    expect(await reminders()).toEqual([])
    expect(await calls()).toEqual([])
  })
})

describe('which chores get a reminder', () => {
  test('not before 4 days, yes at 4 days', async () => {
    await age('dishes', '3 days 23 hours')
    expect(await run()).toBe(0)
    expect(await reminders()).toEqual([])
    await age('dishes', '4 days')
    expect(await run()).toBe(1)
    expect(await reminders()).toHaveLength(1)
  })

  test('records the person on the chore and the start of their turn, and asks notify to send it', async () => {
    await age('trash', '5 days')
    expect(await run()).toBe(1)
    const [reminder] = await reminders()
    const trash = await t.one(`select id, current_member_id, updated_at from chores where slug = 'trash'`)
    expect(reminder.chore_id).toBe(trash.id)
    expect(reminder.member_id).toBe(trash.current_member_id)
    expect(reminder.stint_started_at.getTime()).toBe(trash.updated_at.getTime())
    expect(await calls()).toEqual([{ url: URL, body: { type: 'reminder', reminder_id: reminder.id } }])
  })

  test('both chores can be due at once, each reminded separately', async () => {
    await age('dishes', '6 days')
    await age('trash', '4 days 1 hour')
    expect(await run()).toBe(2)
    expect(await reminders()).toHaveLength(2)
  })
})

describe('quiet hours (reminders go out 08:00 to 23:00 household time)', () => {
  test('nothing goes out overnight, and it all goes out once the window opens', async () => {
    await age('dishes', '6 days')
    for (const hhmm of ['00:00', '03:00', '07:59']) expect(await run(at(hhmm))).toBe(0)
    expect(await reminders()).toEqual([])
    expect(await run(at('08:00'))).toBe(1)
  })

  test('the window closes at 23:00', async () => {
    await age('dishes', '6 days')
    expect(await run(at('22:59'))).toBe(1)
    await reset()
    await age('dishes', '6 days')
    expect(await run(at('23:00'))).toBe(0)
    expect(await run(at('23:30'))).toBe(0)
    expect(await run(at('23:59'))).toBe(0)
  })

  test('uses the configured timezone, not UTC', async () => {
    // 13:00 UTC is 09:00 in New York (inside the window) but 06:00 in Los Angeles (outside).
    const utc1300 = '2026-10-05T13:00:00Z'
    await age('dishes', '6 days')
    await t.db.query('select configure_reminders($1, $2)', [URL, 'America/Los_Angeles'])
    expect(await run(utc1300)).toBe(0)
    await t.db.query('select configure_reminders($1, $2)', [URL, 'America/New_York'])
    expect(await run(utc1300)).toBe(1)
  })
})

describe('sent once, and only to the right person', () => {
  test('a reminder that has not been claimed is re-requested on the next run, without duplicating it', async () => {
    await age('dishes', '5 days')
    await run()
    await run(at('12:30'))
    expect(await reminders()).toHaveLength(1)
    expect(await calls()).toHaveLength(2) // asked twice, same reminder
  })

  test('once notify claims it, it is never requested or announced again', async () => {
    await age('dishes', '5 days')
    await run()
    const [reminder] = await reminders()
    const first = await claim(reminder.id)
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ chore_slug: 'dishes', chore_name: 'Dishes', recipient_id: reminder.member_id })
    expect(first[0].waiting_days).toBeGreaterThanOrEqual(4)
    expect(await claim(reminder.id)).toEqual([])

    const before = (await calls()).length
    expect(await run(at('13:00'))).toBe(0)
    expect((await calls()).length).toBe(before)
  })

  test('one reminder per turn: a still-waiting person is not reminded again days later', async () => {
    await age('dishes', '5 days')
    await run()
    const [reminder] = await reminders()
    await claim(reminder.id)
    // Three more days pass on the same turn.
    expect(await run('2026-10-08T12:00:00-04:00')).toBe(0)
    expect(await reminders()).toHaveLength(1)
  })

  test('a new turn gets its own reminder once it, too, is 4 days old', async () => {
    await age('dishes', '5 days')
    await run()
    const [first] = await reminders()
    await claim(first.id)
    // Dishes is completed by whoever is on it: a new turn starts at NOON for the next person.
    await t.as('anon', () => t.complete(PASSCODE, first.chore_id, t.nameOf(first.member_id)!))
    await t.db.query(`update chores set updated_at = $1::timestamptz where id = $2`, [NOON, first.chore_id])
    await t.db.exec(`update chores set updated_at = '2026-10-08T12:00:00-04:00' where slug = 'trash'`) // Trash stays fresh: only Dishes is due
    expect(await run('2026-10-09T12:00:00-04:00')).toBe(1) // 4 days later
    const all = await reminders()
    expect(all).toHaveLength(2)
    expect(all[1].chore_id).toBe(first.chore_id)
    expect(all[1].member_id).not.toBe(first.member_id) // the next person in the rotation
  })

  test('says nothing if the person did the chore before the reminder went out', async () => {
    await age('dishes', '5 days')
    await run()
    const [reminder] = await reminders()
    await t.as('anon', () => t.complete(PASSCODE, reminder.chore_id, t.nameOf(reminder.member_id)!)) // they do it: the wheel moves on
    expect(await claim(reminder.id)).toEqual([]) // consumed, nothing to send
  })

  test('reminders older than a day are no longer requested', async () => {
    await age('dishes', '5 days')
    await run()
    await t.db.exec('delete from net._calls')
    expect(await run('2026-10-06T13:00:00-04:00')).toBe(0) // 25 hours later
  })
})

describe('access', () => {
  test('the public key cannot read the settings or reminders, or call any of the functions', async () => {
    await age('dishes', '5 days')
    await run()
    const [reminder] = await reminders()
    for (const sql of ['select * from app_settings', 'select * from chore_reminders', 'select send_stale_chore_reminders()']) {
      expect(await rejects(t.as('anon', () => t.rows(sql)))).toBe(true)
    }
    for (const role of ['anon', 'authenticated'] as const) {
      expect(await rejects(t.as(role, () => t.rows('select * from claim_reminder_notification($1, now())', [reminder.id])))).toBe(true)
    }
    expect(await claim(reminder.id)).toHaveLength(1) // failed attempts did not use up the claim
  })

  test('the notify function (service_role) still cannot read the tables directly', async () => {
    expect(await rejects(t.as('service_role', () => t.rows('select * from chore_reminders')))).toBe(true)
  })
})
