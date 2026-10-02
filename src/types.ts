export interface Member {
  id: string
  name: string
  color: string
}

export interface Chore {
  id: string
  slug: string
  name: string
  emoji: string
  checklist: string[]
  /** Members in this chore's rotation order. Each wheel has its own order. */
  rotation: Member[]
  currentMemberId: string
  /** When currentMemberId became responsible (chores.updated_at). */
  since: Date
}

/** One line of the activity feed: someone finished a chore, or checked off a todo. */
export interface ActivityEntry {
  id: string
  kind: 'chore' | 'todo'
  memberId: string
  choreId: string | null
  todoId: string | null
  /** For todo entries: the task's text. */
  todoText: string | null
  createdAt: Date
}

export interface Todo {
  id: string
  text: string
  createdBy: string
  createdAt: Date
  done: boolean
  completedBy: string | null
  completedAt: Date | null
  /** Shown instantly while the server confirms it (optimistic add). */
  pending?: boolean
}
