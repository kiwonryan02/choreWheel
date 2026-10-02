import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactionKind } from '../config/reactions'
import { supabase } from '../lib/supabase'
import type { ActivityEntry, Reaction } from '../types'

const FEED_SIZE = 50

// activity.todo_id -> todos.id is many-to-one, so PostgREST returns one object (or
// null); supabase-js's untyped client guesses a list. Accept either.
function embeddedText(embedded: unknown): string | null {
  const row = Array.isArray(embedded) ? embedded[0] : embedded
  return (row as { text?: string } | null | undefined)?.text ?? null
}

export type ReactionResult =
  | 'ok'
  | 'unchanged'
  | 'not_found'
  | 'invalid'
  | 'locked'
  | 'error'

/**
 * The activity feed: the latest completions, newest first, with their reactions.
 * Bumps never appear here (the table that holds them is private).
 *
 * New entries, removed ones (unchecking a todo deletes its entry) and reactions
 * arrive over Realtime. Rather than patch the list from each event, any change
 * just reloads the page of entries: it is tiny, and always consistent. Our own
 * reactions show up instantly (optimistically) and are reconciled with the server.
 */
export function useActivity(passcode: string) {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const { data, error: queryError } = await supabase
      .from('activity')
      .select('id, kind, member_id, chore_id, todo_id, created_at, todos(text)')
      .order('created_at', { ascending: false })
      .limit(FEED_SIZE)
    if (queryError || !data) {
      setError(queryError?.message ?? 'The server returned no data.')
      return
    }

    // Reactions for exactly the entries on screen. If they fail to load the feed
    // still shows, just without them.
    const byEntry = new Map<string, Reaction[]>()
    if (data.length > 0) {
      const { data: reactions, error: reactionError } = await supabase
        .from('reactions')
        .select('activity_id, member_id, kind')
        .in('activity_id', data.map((row) => row.id))
      if (reactionError) console.warn('Could not load reactions', reactionError)
      for (const r of reactions ?? []) {
        const list = byEntry.get(r.activity_id) ?? []
        list.push({ memberId: r.member_id, kind: r.kind as ReactionKind })
        byEntry.set(r.activity_id, list)
      }
    }

    setEntries(
      data.map((row) => ({
        id: row.id,
        kind: row.kind,
        memberId: row.member_id,
        choreId: row.chore_id,
        todoId: row.todo_id,
        todoText: embeddedText(row.todos),
        createdAt: new Date(row.created_at),
        reactions: byEntry.get(row.id) ?? [],
      })),
    )
    setError(null)
  }, [])

  // Several events can land together (e.g. an uncheck); load once for the burst.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const refreshSoon = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void refresh(), 150)
  }, [refresh])

  useEffect(() => {
    void refresh()

    let subscribedBefore = false
    const channel = supabase
      .channel('activity-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity' }, refreshSoon)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'activity' }, refreshSoon)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reactions' }, refreshSoon)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'reactions' }, refreshSoon)
      .subscribe((status) => {
        // After a dropped connection, catch up on anything we missed.
        if (status === 'SUBSCRIBED' && subscribedBefore) void refresh()
        if (status === 'SUBSCRIBED') subscribedBefore = true
      })

    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', onVisible)
      void supabase.removeChannel(channel)
    }
  }, [refresh, refreshSoon])

  /** Add (on = true) or take back (on = false) one of my reactions on an entry. */
  const setReaction = useCallback(
    async (entryId: string, kind: ReactionKind, on: boolean, memberId: string): Promise<ReactionResult> => {
      const isMine = (r: Reaction) => r.memberId === memberId && r.kind === kind
      setEntries((all) =>
        all
          ? all.map((entry) => {
              if (entry.id !== entryId) return entry
              if (on) return entry.reactions.some(isMine) ? entry : { ...entry, reactions: [...entry.reactions, { memberId, kind }] }
              return { ...entry, reactions: entry.reactions.filter((r) => !isMine(r)) }
            })
          : all,
      )

      const { data, error: rpcError } = await supabase.rpc('set_reaction', {
        p_passcode: passcode,
        p_activity_id: entryId,
        p_member_id: memberId,
        p_kind: kind,
        p_on: on,
      })
      const status = (data as { status: string }[] | null)?.[0]?.status
      if (rpcError || !status) {
        await refresh()
        return 'error'
      }
      if (status !== 'ok' && status !== 'unchanged') await refresh() // roll back to the server's truth
      return status as ReactionResult
    },
    [passcode, refresh],
  )

  return { entries, error, retry: refresh, setReaction }
}
