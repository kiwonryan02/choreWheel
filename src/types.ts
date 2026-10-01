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
