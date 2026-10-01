import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CHORE_ORDER, CHORE_UI, FALLBACK_CHORE_UI } from '../config/chores'
import { supabase } from '../lib/supabase'
import type { Chore, Member } from '../types'

interface ChoreRow {
  id: string
  slug: string
  name: string
  currentMemberId: string
  since: Date
}

interface CompleteChoreRow {
  advanced: boolean
  up_now: string
  since: string
}

export type CompleteResult = 'done' | 'stale' | 'error'

/**
 * Shared household state: members, both wheels, and their rotations.
 *
 * Loaded once, then kept live by Supabase Realtime. Completing a chore updates
 * the wheel optimistically and is reconciled with whatever the server says
 * (the RPC result, or a Realtime event, whichever arrives).
 */
export function useHousehold() {
  const [members, setMembers] = useState<Member[]>([])
  const [rows, setRows] = useState<ChoreRow[]>([])
  const [rotations, setRotations] = useState<Record<string, string[]>>({})
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(false)

  // Newest server timestamp applied per chore. A late Realtime event or RPC
  // reply for an older state is ignored instead of rolling the wheel back.
  const stamps = useRef<Record<string, number>>({})

  const refresh = useCallback(async () => {
    const [m, c, r] = await Promise.all([
      supabase.from('members').select('id,name,color').order('position'),
      supabase.from('chores').select('id,slug,name,current_member_id,updated_at'),
      supabase.from('chore_rotation').select('chore_id,member_id,position').order('position'),
    ])
    const failure = m.error ?? c.error ?? r.error
    if (failure || !m.data || !c.data || !r.data) {
      setError(failure?.message ?? 'The server returned no data.')
      return
    }

    const nextRotations: Record<string, string[]> = {}
    for (const entry of r.data) {
      ;(nextRotations[entry.chore_id] ??= []).push(entry.member_id)
    }
    stamps.current = {}
    for (const chore of c.data) stamps.current[chore.id] = Date.parse(chore.updated_at)

    setMembers(m.data)
    setRotations(nextRotations)
    setRows(
      c.data.map((chore) => ({
        id: chore.id,
        slug: chore.slug,
        name: chore.name,
        currentMemberId: chore.current_member_id,
        since: new Date(chore.updated_at),
      })),
    )
    setError(null)
    setLoaded(true)
  }, [])

  const applyServerState = useCallback((choreId: string, memberId: string, updatedAt: string) => {
    const stamp = Date.parse(updatedAt)
    if (stamp < (stamps.current[choreId] ?? 0)) return
    stamps.current[choreId] = stamp
    setRows((all) =>
      all.map((row) =>
        row.id === choreId ? { ...row, currentMemberId: memberId, since: new Date(stamp) } : row,
      ),
    )
  }, [])

  useEffect(() => {
    void refresh()

    let subscribedBefore = false
    const channel = supabase
      .channel('chores-live')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chores' }, (payload) => {
        const row = payload.new as { id: string; current_member_id: string; updated_at: string }
        applyServerState(row.id, row.current_member_id, row.updated_at)
      })
      .subscribe((status) => {
        setLive(status === 'SUBSCRIBED')
        // After a dropped connection, catch up on anything we missed.
        if (status === 'SUBSCRIBED' && subscribedBefore) void refresh()
        if (status === 'SUBSCRIBED') subscribedBefore = true
      })

    // Phones suspend sockets in the background; resync when the app returns.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      void supabase.removeChannel(channel)
    }
  }, [refresh, applyServerState])

  const completeChore = useCallback(
    async (choreId: string, memberId: string): Promise<CompleteResult> => {
      const order = rotations[choreId]
      // Optimistic: spin the wheel now, as long as this person really is on top.
      if (order?.length) {
        setRows((all) =>
          all.map((row) => {
            if (row.id !== choreId || row.currentMemberId !== memberId) return row
            const next = order[(order.indexOf(memberId) + 1) % order.length]
            return { ...row, currentMemberId: next, since: new Date() }
          }),
        )
      }

      const { data, error: rpcError } = await supabase.rpc('complete_chore', {
        p_chore_id: choreId,
        p_expected_member_id: memberId,
      })
      const result = (data as CompleteChoreRow[] | null)?.[0]
      if (rpcError || !result) {
        await refresh() // roll the optimistic change back to the server's truth
        return 'error'
      }

      applyServerState(choreId, result.up_now, result.since)
      return result.advanced ? 'done' : 'stale'
    },
    [rotations, refresh, applyServerState],
  )

  const chores = useMemo<Chore[]>(() => {
    const byId = new Map(members.map((m) => [m.id, m]))
    const rank = (slug: string) => {
      const i = CHORE_ORDER.indexOf(slug)
      return i === -1 ? CHORE_ORDER.length : i
    }
    return rows
      .map((row) => {
        const ui = CHORE_UI[row.slug] ?? FALLBACK_CHORE_UI
        return {
          id: row.id,
          slug: row.slug,
          name: row.name,
          emoji: ui.emoji,
          checklist: ui.checklist,
          rotation: (rotations[row.id] ?? []).flatMap((id) => byId.get(id) ?? []),
          currentMemberId: row.currentMemberId,
          since: row.since,
        }
      })
      .sort((a, b) => rank(a.slug) - rank(b.slug))
  }, [rows, rotations, members])

  return { members, chores, loaded, error, live, completeChore, retry: refresh }
}
