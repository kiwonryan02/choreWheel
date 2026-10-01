// Runs the real migrations + seed in an in-process Postgres (PGlite) so the
// SQL can be tested without a Supabase project. This is NOT Supabase itself:
// roles and the realtime publication are stubs, and (like a new Supabase
// project) the stub roles get no default table privileges.
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SUPABASE_DIR = join(import.meta.dir, '../../supabase')

export const PASSCODE = '4821'

export async function createDb(options: { passcode?: string | null } = {}) {
  const passcode = options.passcode === undefined ? PASSCODE : options.passcode
  const db = new PGlite()
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls; -- as on Supabase: skips RLS, but still needs table grants
    create publication supabase_realtime;
  `)
  const migrations = readdirSync(join(SUPABASE_DIR, 'migrations')).sort()
  for (const file of migrations) {
    await db.exec(readFileSync(join(SUPABASE_DIR, 'migrations', file), 'utf8'))
  }
  await db.exec(readFileSync(join(SUPABASE_DIR, 'seed.sql'), 'utf8'))
  if (passcode) await db.query('select set_household_passcode($1)', [passcode])

  // Rows as plain objects. Runs as whatever role is active.
  const rows = async (sql: string, params: unknown[] = []) =>
    (await db.query<Record<string, any>>(sql, params)).rows

  /** Runs fn as a database role (like a request through the API would). */
  async function as<T>(role: 'anon' | 'authenticated' | 'service_role', fn: () => Promise<T>) {
    await db.exec(`set role ${role}`)
    try {
      return await fn()
    } finally {
      await db.exec('reset role')
    }
  }

  const one = async (sql: string, params: unknown[] = []) => (await rows(sql, params))[0]
  const choreId = async (slug: string) => (await one('select id from chores where slug = $1', [slug])).id as string
  const members = Object.fromEntries(
    (await rows('select id, name from members')).map((m) => [m.name as string, m.id as string]),
  ) as Record<string, string>
  const nameOf = (id: string | null) => Object.keys(members).find((n) => members[n] === id) ?? null

  const complete = (pass: string | null, chore: string, who: string) =>
    one('select * from complete_chore($1, $2, $3)', [pass, chore, members[who]])

  return { db, rows, one, as, choreId, members, nameOf, complete }
}

/** True if the promise rejects (e.g. permission denied). */
export async function rejects(p: Promise<unknown>): Promise<boolean> {
  try {
    await p
    return false
  } catch {
    return true
  }
}
