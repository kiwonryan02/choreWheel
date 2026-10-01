// Presentation config per chore slug. Who is in each rotation, and in what
// order, lives in the database (supabase/seed.sql).

interface ChoreUi {
  emoji: string
  /** What "done" means. A reference in the completion sheet, never validated. */
  checklist: string[]
}

export const CHORE_UI: Record<string, ChoreUi> = {
  dishes: {
    emoji: '🍽️',
    checklist: [
      'Cleared the dishwasher (only if it was clean)',
      'Cleared all dishes from the sink and kitchen, by loading the dishwasher or hand-washing',
      'Ran the dishwasher (only if it was full)',
    ],
  },
  trash: {
    emoji: '🗑️',
    checklist: [
      'Swept the living room and kitchen for loose trash',
      'Bagged all trash in the trash area',
      'Left the bags by the door',
    ],
  },
}

export const FALLBACK_CHORE_UI: ChoreUi = { emoji: '🧹', checklist: [] }

/** Display order of the wheels on the home screen. */
export const CHORE_ORDER = ['dishes', 'trash']
