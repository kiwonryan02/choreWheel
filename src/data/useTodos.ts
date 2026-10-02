import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Todo } from '../types'
import { announceTodoDone } from './push'

/** How many finished todos the Done section keeps. */
const DONE_LIMIT = 20

interface TodoRowData {
  id: string
  text: string
  created_by: string
  created_at: string
  done: boolean
  completed_by: string | null
  completed_at: string | null
}

const COLUMNS = 'id, text, created_by, created_at, done, completed_by, completed_at'

function toTodo(row: TodoRowData): Todo {
  return {
    id: row.id,
    text: row.text,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    done: row.done,
    completedBy: row.completed_by,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
  }
}

const byOldestFirst = (a: Todo, b: Todo) => a.createdAt.getTime() - b.createdAt.getTime()
const byNewestDone = (a: Todo, b: Todo) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0)

export type TodoResult =
  | 'ok'
  | 'empty'
  | 'too_long'
  | 'unchanged'
  | 'not_found'
  | 'not_creator'
  | 'already_done'
  | 'invalid'
  | 'locked'
  | 'error'

interface StatusRow {
  status: string
  todo_id?: string | null
}

/**
 * The shared todo list. Open todos are oldest first; Done shows the 20 most
 * recent. Changes arrive over Realtime, and our own actions show up instantly
 * (optimistically) and are reconciled with whatever the server reports.
 */
export function useTodos(passcode: string) {
  const [open, setOpen] = useState<Todo[]>([])
  const [done, setDone] = useState<Todo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [openRes, doneRes] = await Promise.all([
      supabase.from('todos').select(COLUMNS).eq('done', false).order('created_at', { ascending: true }),
      supabase.from('todos').select(COLUMNS).eq('done', true).order('completed_at', { ascending: false }).limit(DONE_LIMIT),
    ])
    const failure = openRes.error ?? doneRes.error
    if (failure || !openRes.data || !doneRes.data) {
      setError(failure?.message ?? 'The server returned no data.')
      return
    }
    setOpen(openRes.data.map(toTodo))
    setDone(doneRes.data.map(toTodo))
    setError(null)
    setLoaded(true)
  }, [])

  // Put one todo (from the server) in the right list, wherever it was before.
  const applyRow = useCallback((todo: Todo) => {
    setOpen((all) => {
      const rest = all.filter((t) => t.id !== todo.id && !(t.pending && t.text === todo.text && t.createdBy === todo.createdBy))
      return todo.done ? rest : [...rest, todo].sort(byOldestFirst)
    })
    setDone((all) => {
      const rest = all.filter((t) => t.id !== todo.id)
      return todo.done ? [...rest, todo].sort(byNewestDone).slice(0, DONE_LIMIT) : rest
    })
  }, [])

  const dropRow = useCallback((id: string) => {
    setOpen((all) => all.filter((t) => t.id !== id))
    setDone((all) => all.filter((t) => t.id !== id))
  }, [])

  useEffect(() => {
    void refresh()

    let subscribedBefore = false
    const channel = supabase
      .channel('todos-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'todos' }, (p) => applyRow(toTodo(p.new as TodoRowData)))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'todos' }, (p) => applyRow(toTodo(p.new as TodoRowData)))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'todos' }, (p) => dropRow((p.old as { id: string }).id))
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
      document.removeEventListener('visibilitychange', onVisible)
      void supabase.removeChannel(channel)
    }
  }, [refresh, applyRow, dropRow])

  const pendingCounter = useRef(0)

  const addTodo = useCallback(
    async (rawText: string, memberId: string): Promise<TodoResult> => {
      const text = rawText.trim()
      if (!text) return 'empty'
      if (text.length > 200) return 'too_long'

      // Show it immediately; swap in the real row when the server answers.
      const pendingId = `pending-${++pendingCounter.current}`
      setOpen((all) =>
        [...all, { id: pendingId, text, createdBy: memberId, createdAt: new Date(), done: false, completedBy: null, completedAt: null, pending: true }].sort(byOldestFirst),
      )

      const { data, error: rpcError } = await supabase.rpc('create_todo', {
        p_passcode: passcode,
        p_text: text,
        p_member_id: memberId,
      })
      const row = (data as StatusRow[] | null)?.[0]
      if (rpcError || !row || row.status !== 'ok' || !row.todo_id) {
        setOpen((all) => all.filter((t) => t.id !== pendingId))
        if (rpcError || !row) return 'error'
        return row.status as TodoResult
      }

      // Swap the placeholder for the real row in one step (no flicker). If
      // Realtime already delivered it, just drop the placeholder.
      const realId = row.todo_id
      setOpen((all) => {
        const rest = all.filter((t) => t.id !== pendingId)
        if (rest.some((t) => t.id === realId)) return rest
        const created: Todo = { id: realId, text, createdBy: memberId, createdAt: new Date(), done: false, completedBy: null, completedAt: null }
        return [...rest, created].sort(byOldestFirst)
      })
      void refresh() // pick up the server's exact timestamp
      return 'ok'
    },
    [passcode, refresh],
  )

  const setTodoDone = useCallback(
    async (todo: Todo, nextDone: boolean, memberId: string): Promise<TodoResult> => {
      // Optimistic move between lists.
      applyRow({
        ...todo,
        done: nextDone,
        completedBy: nextDone ? memberId : null,
        completedAt: nextDone ? new Date() : null,
      })

      const { data, error: rpcError } = await supabase.rpc('set_todo_done', {
        p_passcode: passcode,
        p_todo_id: todo.id,
        p_member_id: memberId,
        p_done: nextDone,
      })
      const status = (data as StatusRow[] | null)?.[0]?.status
      if (rpcError || !status) {
        await refresh()
        return 'error'
      }
      // 'unchanged' means someone else got there first; the server's version wins.
      if (status !== 'ok') await refresh()
      // Ping the others about a check-off (not an uncheck). 'unchanged' is skipped on
      // purpose: whoever got there first announces it, and the server sends it only once.
      else if (nextDone) void announceTodoDone(todo.id)
      return status as TodoResult
    },
    [passcode, applyRow, refresh],
  )

  const deleteTodo = useCallback(
    async (todo: Todo, memberId: string): Promise<TodoResult> => {
      dropRow(todo.id)
      const { data, error: rpcError } = await supabase.rpc('delete_todo', {
        p_passcode: passcode,
        p_todo_id: todo.id,
        p_member_id: memberId,
      })
      const status = (data as StatusRow[] | null)?.[0]?.status
      if (rpcError || !status) {
        await refresh()
        return 'error'
      }
      if (status !== 'ok') await refresh()
      return status as TodoResult
    },
    [passcode, dropRow, refresh],
  )

  return { open, done, loaded, error, addTodo, setTodoDone, deleteTodo, retry: refresh }
}
