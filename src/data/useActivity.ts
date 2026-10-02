import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { ActivityEntry } from '../types'

const FEED_SIZE = 50

// activity.todo_id -> todos.id is many-to-one, so PostgREST returns one object (or
// null); supabase-js's untyped client guesses a list. Accept either.
function embeddedText(embedded: unknown): string | null {
  const row = Array.isArray(embedded) ? embedded[0] : embedded
  return (row as { text?: string } | null | undefined)?.text ?? null
}

/**
 * The activity feed: the latest completions, newest first. Bumps never appear
 * here (the table that holds them is private).
 *
 * New entries and removed ones (unchecking a todo deletes its entry) arrive
 * over Realtime. Rather than patch the list from each event, any change just
 * reloads the page of entries: it is tiny, and always consistent.
 */
export function useActivity() {
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
    setEntries(
      data.map((row) => ({
        id: row.id,
        kind: row.kind,
        memberId: row.member_id,
        choreId: row.chore_id,
        todoId: row.todo_id,
        todoText: embeddedText(row.todos),
        createdAt: new Date(row.created_at),
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

  return { entries, error, retry: refresh }
}
