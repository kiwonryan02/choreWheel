export interface Member {
  id: string
  name: string
  color: string
}

export interface Chore {
  slug: 'dishes' | 'trash'
  name: string
  emoji: string
  /** Members in this chore's rotation order. Each wheel has its own order. */
  rotation: Member[]
  currentMemberId: string
  /** When currentMemberId became responsible (maps to chores.updated_at). */
  since: Date
}
