import { describe, expect, test } from 'bun:test'
import { buildCompletedMessage } from '../supabase/functions/notify/message.ts'

describe('buildCompletedMessage', () => {
  test('matches the wording in the spec', () => {
    const msg = buildCompletedMessage({ choreSlug: 'dishes', choreName: 'Dishes', completerName: 'Sam', nextName: 'Alex' })
    expect(msg.body).toBe('Sam finished the dishes. Next up: Alex.')
    expect(msg.title).toBe('Dishes done')
  })

  test('uses a per-chore tag so a newer ping replaces an older one', () => {
    const a = buildCompletedMessage({ choreSlug: 'trash', choreName: 'Trash', completerName: 'A', nextName: 'B' })
    expect(a.tag).toBe('chore-trash')
    expect(a.url).toBe('/')
  })

  test('leaves out "Next up" when the next person is the same person', () => {
    const msg = buildCompletedMessage({ choreSlug: 'trash', choreName: 'Trash', completerName: 'Sam', nextName: 'Sam' })
    expect(msg.body).toBe('Sam finished the trash.')
  })
})
