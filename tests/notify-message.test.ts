import { describe, expect, test } from 'bun:test'
import { buildBumpMessage, buildCompletedMessage, buildTodoDoneMessage } from '../supabase/functions/notify/message.ts'

describe('buildBumpMessage', () => {
  test('matches the wording in the spec', () => {
    const msg = buildBumpMessage({ choreSlug: 'trash', choreName: 'Trash' })
    expect(msg.body).toBe('Friendly nudge: the trash is waiting on you.')
    expect(msg.title).toBe('Trash')
    expect(msg.tag).toBe('bump-trash')
  })

  test('agrees with plural chore names: "the dishes are waiting"', () => {
    expect(buildBumpMessage({ choreSlug: 'dishes', choreName: 'Dishes' }).body).toBe(
      'Friendly nudge: the dishes are waiting on you.',
    )
  })

  test('is built from the chore alone, so it cannot name a sender', () => {
    // The function signature takes no person at all; this guards the output too.
    const msg = JSON.stringify(buildBumpMessage({ choreSlug: 'dishes', choreName: 'Dishes' }))
    for (const name of ['Kiwon', 'Lucas', 'Anish', 'Carter']) expect(msg).not.toContain(name)
  })

  test('uses its own tag so it never replaces a "done" notification', () => {
    const bump = buildBumpMessage({ choreSlug: 'dishes', choreName: 'Dishes' })
    const done = buildCompletedMessage({ choreSlug: 'dishes', choreName: 'Dishes', completerName: 'A', nextName: 'B' })
    expect(bump.tag).not.toBe(done.tag)
  })
})

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

describe('buildTodoDoneMessage', () => {
  test('says who checked off what', () => {
    const msg = buildTodoDoneMessage({ todoId: 'abc', todoText: 'Buy paper towels', completerName: 'Alex' })
    expect(msg.body).toBe("Alex checked off 'Buy paper towels'")
    expect(msg.title).toBe('Todo done')
    expect(msg.url).toBe('/')
  })

  test('shortens very long tasks so the notification stays readable', () => {
    const msg = buildTodoDoneMessage({ todoId: 'abc', todoText: 'x'.repeat(200), completerName: 'Alex' })
    expect(msg.body).toBe(`Alex checked off '${'x'.repeat(99)}…'`)
    const exact = buildTodoDoneMessage({ todoId: 'abc', todoText: 'y'.repeat(100), completerName: 'Alex' })
    expect(exact.body).toBe(`Alex checked off '${'y'.repeat(100)}'`)
  })

  test("gives each todo its own tag so quick successive check-offs don't replace each other", () => {
    const a = buildTodoDoneMessage({ todoId: 'one', todoText: 'a', completerName: 'A' })
    const b = buildTodoDoneMessage({ todoId: 'two', todoText: 'b', completerName: 'A' })
    expect(a.tag).toBe('todo-one')
    expect(a.tag).not.toBe(b.tag)
  })
})
