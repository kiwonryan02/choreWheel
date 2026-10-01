import { beforeAll, describe, expect, test } from 'bun:test'
import { createDb, rejects } from './helpers'

let t: Awaited<ReturnType<typeof createDb>>
let dishes: string
beforeAll(async () => {
  t = await createDb({ passcode: null }) // starts with no passcode set
  dishes = await t.choreId('dishes')
})

const verify = async (p: string | null) => (await t.one('select verify_passcode($1) v', [p])).v

describe('setting the passcode (SQL editor only)', () => {
  test.each(['123', '12ab', '1234567', ''])('rejects %p', async (bad) => {
    expect(await rejects(t.db.query('select set_household_passcode($1)', [bad]))).toBe(true)
  })
})

describe('before a passcode exists', () => {
  test('verify and complete_chore both report not_set and change nothing', async () => {
    expect(await t.as('anon', () => verify('1234'))).toBe('not_set')
    const r = await t.as('anon', () => t.complete('1234', dishes, 'Kiwon'))
    expect(r.status).toBe('not_set')
    expect(r.up_now).toBeNull()
  })
})

describe('with a passcode set', () => {
  test('is stored salted and hashed, never in plaintext', async () => {
    await t.db.query(`select set_household_passcode('4821')`)
    const stored = await t.one('select passcode_salt, passcode_hash from household_settings')
    expect(JSON.stringify(stored)).not.toContain('4821')
    expect(stored.passcode_hash).toHaveLength(64)
  })

  test('right passcode -> ok; wrong or missing -> invalid', async () => {
    await t.as('anon', async () => {
      expect(await verify('4821')).toBe('ok')
      expect(await verify('0000')).toBe('invalid')
      expect(await verify(null)).toBe('invalid')
    })
  })

  test('a wrong passcode on complete_chore changes nothing but the failure is still recorded', async () => {
    const before = (await t.one('select count(*)::int n from passcode_failures')).n
    const r = await t.as('anon', () => t.complete('9999', dishes, 'Kiwon'))
    expect(r.status).toBe('invalid')
    expect(t.nameOf((await t.one(`select current_member_id id from chores where slug = 'dishes'`)).id)).toBe('Kiwon')
    expect((await t.one('select count(*)::int n from activity')).n).toBe(0)
    // Reported as a status (not an exception) precisely so this record survives.
    expect((await t.one('select count(*)::int n from passcode_failures')).n).toBe(before + 1)
  })
})

describe('throttling', () => {
  test('10 wrong guesses lock everything, even the right passcode', async () => {
    await t.as('anon', async () => {
      for (let i = 0; i < 10; i++) await verify('0000')
      expect(await verify('0000')).toBe('locked')
      expect(await verify('4821')).toBe('locked')
      expect((await t.complete('4821', dishes, 'Kiwon')).status).toBe('locked')
    })
  })

  test('the lock clears once failures age out of the 15 minute window', async () => {
    await t.db.exec(`update passcode_failures set attempted_at = now() - interval '16 minutes'`)
    expect(await t.as('anon', () => verify('4821'))).toBe('ok')
  })

  test('changing the passcode invalidates the old one and resets the counter', async () => {
    await t.db.query(`select set_household_passcode('777777')`)
    expect((await t.one('select count(*)::int n from passcode_failures')).n).toBe(0)
    await t.as('anon', async () => {
      expect(await verify('4821')).toBe('invalid')
      expect(await verify('777777')).toBe('ok')
    })
  })
})
