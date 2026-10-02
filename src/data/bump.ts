import { supabase } from '../lib/supabase'

export type BumpStatus = 'sent' | 'rate_limited' | 'stale' | 'invalid' | 'locked' | 'not_set'

interface BumpRow {
  status: BumpStatus
  bump_id: string | null
}

/**
 * Anonymously nudges whoever is on top of a chore. Note what is NOT sent: no
 * member id for the bumper. The server never learns who bumped.
 */
export async function bumpChore(
  passcode: string,
  choreId: string,
  targetMemberId: string,
): Promise<{ status: BumpStatus | 'error'; bumpId: string | null }> {
  const { data, error } = await supabase.rpc('bump_chore', {
    p_passcode: passcode,
    p_chore_id: choreId,
    p_expected_member_id: targetMemberId,
  })
  const row = (data as BumpRow[] | null)?.[0]
  if (error || !row) return { status: 'error', bumpId: null }
  return { status: row.status, bumpId: row.bump_id }
}

export interface Nudge {
  choreId: string
  nudgedAt: string
}

interface NudgeRow {
  status: 'ok' | 'invalid' | 'locked' | 'not_set'
  chore_id: string | null
  nudged_at: string | null
}

/** Chores this person is on top of that someone has nudged them about. */
export async function fetchNudges(
  passcode: string,
  memberId: string,
): Promise<{ status: 'ok'; nudges: Nudge[] } | { status: 'invalid' | 'locked' | 'not_set' | 'error' }> {
  const { data, error } = await supabase.rpc('get_nudges', {
    p_passcode: passcode,
    p_member_id: memberId,
  })
  const rows = data as NudgeRow[] | null
  if (error || !rows) return { status: 'error' }
  const refused = rows.find((r) => r.status !== 'ok')
  if (refused) return { status: refused.status as 'invalid' | 'locked' | 'not_set' }
  return {
    status: 'ok',
    nudges: rows.flatMap((r) => (r.chore_id && r.nudged_at ? [{ choreId: r.chore_id, nudgedAt: r.nudged_at }] : [])),
  }
}
