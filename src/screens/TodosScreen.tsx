import { useState, type FormEvent } from 'react'
import type { TodoResult, useTodos } from '../data/useTodos'
import { timeAgo } from '../lib/time'
import { useNow } from '../lib/useNow'
import type { Member, Todo } from '../types'

const MAX_LENGTH = 200

interface TodosScreenProps {
  members: Member[]
  me: Member
  todos: ReturnType<typeof useTodos>
  showNotice: (message: string) => void
  onPasscodeRejected: () => void
}

/** The shared list: anyone adds and checks off; only the creator deletes (open items only). */
export default function TodosScreen({ members, me, todos, showNotice, onPasscodeRejected }: TodosScreenProps) {
  const { open, done, loaded, error, addTodo, setTodoDone, deleteTodo, retry } = todos
  const now = useNow()
  const [text, setText] = useState('')
  const [showDone, setShowDone] = useState(false)

  const nameOf = (id: string | null) => members.find((m) => m.id === id)?.name ?? 'Someone'
  const canAdd = text.trim().length > 0

  // Turns the outcome of any todo action into the right reaction.
  function report(result: TodoResult, messages: Partial<Record<TodoResult, string>> = {}) {
    if (result === 'invalid') return onPasscodeRejected()
    const message =
      messages[result] ??
      (result === 'locked'
        ? 'Too many wrong passcode tries. Wait a few minutes and try again.'
        : result === 'error'
          ? "Couldn't save that. Check your connection and try again."
          : null)
    if (message) showNotice(message)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!canAdd) return
    const submitted = text
    setText('') // the item appears right away; restore the text if it fails
    const result = await addTodo(submitted, me.id)
    if (result !== 'ok') setText(submitted)
    report(result, { too_long: `Keep it under ${MAX_LENGTH} characters.`, empty: 'Type something to add.' })
  }

  const check = async (todo: Todo, next: boolean) =>
    report(await setTodoDone(todo, next, me.id), {
      unchanged: next ? 'Someone just checked that off.' : 'It was already open.',
      not_found: 'That task was removed.',
    })

  const remove = async (todo: Todo) =>
    report(await deleteTodo(todo, me.id), {
      not_creator: 'Only the person who added it can delete it.',
      already_done: 'It was just checked off, so it can no longer be deleted.',
      not_found: 'That task was already removed.',
    })

  return (
    <div>
      <form
        onSubmit={submit}
        className="sticky top-14 z-10 flex gap-2 bg-slate-50/90 px-6 py-2 backdrop-blur dark:bg-slate-950/90"
      >
        <label htmlFor="new-todo" className="sr-only">
          Add a task
        </label>
        <input
          id="new-todo"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_LENGTH}
          placeholder="Add a task…"
          autoComplete="off"
          enterKeyHint="done"
          className="min-w-0 flex-1 rounded-xl border-2 border-slate-300 bg-white px-3.5 py-2.5 text-base outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900"
        />
        <button
          type="submit"
          disabled={!canAdd}
          className="shrink-0 rounded-xl px-4 py-2.5 font-semibold text-white disabled:opacity-40"
          style={{ backgroundColor: me.color }}
        >
          Add
        </button>
      </form>
      {text.length >= 160 && (
        <p className="px-6 text-right text-xs text-slate-500 dark:text-slate-400">
          {text.length}/{MAX_LENGTH}
        </p>
      )}

      {!loaded ? (
        <p className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
          {error ? (
            <>
              <span className="block font-semibold text-slate-900 dark:text-slate-100">Couldn't load the tasks.</span>
              <span className="mt-2 block text-sm break-words">{error}</span>
              <button
                type="button"
                onClick={() => void retry()}
                className="mt-6 rounded-2xl border-2 border-slate-300 px-6 py-3 font-semibold text-slate-900 dark:border-slate-700 dark:text-slate-100"
              >
                Try again
              </button>
            </>
          ) : (
            'Loading…'
          )}
        </p>
      ) : (
        <>
          {open.length === 0 ? (
            <p className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">Nothing to do. Add something.</p>
          ) : (
            <ul className="divide-y divide-slate-200 px-6 dark:divide-slate-800">
              {open.map((todo) => (
                <OpenRow
                  key={todo.id}
                  todo={todo}
                  addedBy={nameOf(todo.createdBy)}
                  age={timeAgo(todo.createdAt, now)}
                  color={me.color}
                  canDelete={todo.createdBy === me.id && !todo.pending}
                  onCheck={() => void check(todo, true)}
                  onDelete={() => void remove(todo)}
                />
              ))}
            </ul>
          )}

          {done.length > 0 && (
            <section className="mt-4 px-6">
              <button
                type="button"
                onClick={() => setShowDone((v) => !v)}
                aria-expanded={showDone}
                className="flex w-full items-center justify-between py-3 text-sm font-semibold text-slate-500 dark:text-slate-400"
              >
                Done ({done.length})
                <svg viewBox="0 0 12 12" className={`size-3 transition-transform ${showDone ? 'rotate-180' : ''}`} aria-hidden="true">
                  <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {showDone && (
                <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                  {done.map((todo) => (
                    <li key={todo.id} className="flex items-start gap-3 py-3">
                      <input
                        type="checkbox"
                        checked
                        onChange={() => void check(todo, false)}
                        aria-label={`Uncheck: ${todo.text}`}
                        className="mt-0.5 size-6 shrink-0"
                        style={{ accentColor: me.color }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-slate-500 line-through dark:text-slate-400">{todo.text}</p>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          checked by {nameOf(todo.completedBy)}
                          {todo.completedAt && ` · ${timeAgo(todo.completedAt, now)}`}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}

interface OpenRowProps {
  todo: Todo
  addedBy: string
  age: string
  color: string
  canDelete: boolean
  onCheck: () => void
  onDelete: () => void
}

function OpenRow({ todo, addedBy, age, color, canDelete, onCheck, onDelete }: OpenRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <li className={`flex items-start gap-3 py-3 ${todo.pending ? 'opacity-60' : ''}`}>
      <input
        type="checkbox"
        checked={false}
        disabled={todo.pending}
        onChange={onCheck}
        aria-label={`Check off: ${todo.text}`}
        className="mt-0.5 size-6 shrink-0"
        style={{ accentColor: color }}
      />
      <div className="min-w-0 flex-1">
        <p className="break-words">{todo.text}</p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          added by {addedBy} · {age}
        </p>
        {menuOpen && (
          <div className="mt-2 flex gap-4 text-sm font-semibold">
            <button type="button" onClick={onDelete} className="text-rose-600 dark:text-rose-400">
              Delete
            </button>
            <button type="button" onClick={() => setMenuOpen(false)} className="text-slate-500 dark:text-slate-400">
              Cancel
            </button>
          </div>
        )}
      </div>
      {canDelete && !menuOpen && (
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label={`More options for: ${todo.text}`}
          className="-mr-2 shrink-0 rounded-full px-2 py-1 text-lg leading-none text-slate-400"
        >
          ⋯
        </button>
      )}
    </li>
  )
}
