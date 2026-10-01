// Household seed config. Mirrors supabase/seed.sql — keep the two in sync.
// Milestone 1 renders straight from this file; from Milestone 2 on the app
// reads members/chores from Supabase and this file only documents the seed.
import type { Chore, Member } from '../types'

export const MEMBERS: Member[] = [
  { id: 'kiwon', name: 'Kiwon', color: '#2563eb' },
  { id: 'lucas', name: 'Lucas', color: '#047857' },
  { id: 'anish', name: 'Anish', color: '#b45309' },
  { id: 'carter', name: 'Carter', color: '#be185d' },
]

function rotation(...ids: string[]): Member[] {
  return ids.map((id) => {
    const member = MEMBERS.find((m) => m.id === id)
    if (!member) throw new Error(`Unknown member id in rotation: ${id}`)
    return member
  })
}

const HOUR = 60 * 60 * 1000

// Both wheels start on Kiwon, but rotate in different orders so the two
// chores don't hand off to the same person.
// TODO(M2): replace this mock `since` with chores.updated_at from Supabase.
export const CHORES: Chore[] = [
  {
    slug: 'dishes',
    name: 'Dishes',
    emoji: '🍽️',
    rotation: rotation('kiwon', 'lucas', 'anish', 'carter'),
    currentMemberId: 'kiwon',
    since: new Date(Date.now() - 3 * HOUR),
  },
  {
    slug: 'trash',
    name: 'Trash',
    emoji: '🗑️',
    rotation: rotation('kiwon', 'carter', 'anish', 'lucas'),
    currentMemberId: 'kiwon',
    since: new Date(Date.now() - 26 * HOUR),
  },
]
