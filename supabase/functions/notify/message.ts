// Pure message building for the notify function. No imports, so it runs under
// Deno (the Edge runtime) and under bun (tests) alike.

export interface PushMessage {
  title: string
  body: string
  /** Notifications with the same tag replace each other on the device. */
  tag: string
  url: string
}

export interface CompletedInput {
  choreSlug: string
  choreName: string
  completerName: string
  /** Who is up next; may equal the completer if the rotation has one person. */
  nextName: string
}

export interface BumpInput {
  choreSlug: string
  choreName: string
}

/**
 * "Friendly nudge: the trash is waiting on you."
 * Deliberately takes no sender: a bump is anonymous, so nothing here (or in
 * the data it is built from) can say who sent it.
 */
export function buildBumpMessage({ choreSlug, choreName }: BumpInput): PushMessage {
  const verb = choreName.toLowerCase().endsWith('s') ? 'are' : 'is' // "the dishes are", "the trash is"
  return {
    title: choreName,
    body: `Friendly nudge: the ${choreName.toLowerCase()} ${verb} waiting on you.`,
    tag: `bump-${choreSlug}`,
    url: '/',
  }
}

export interface TodoDoneInput {
  todoId: string
  todoText: string
  completerName: string
}

const TODO_TEXT_MAX = 100

/** "Alex checked off 'Buy paper towels'" (long tasks are shortened for the notification). */
export function buildTodoDoneMessage({ todoId, todoText, completerName }: TodoDoneInput): PushMessage {
  const text =
    todoText.length > TODO_TEXT_MAX ? `${todoText.slice(0, TODO_TEXT_MAX - 1).trimEnd()}…` : todoText
  return {
    title: 'Todo done',
    body: `${completerName} checked off '${text}'`,
    tag: `todo-${todoId}`,
    url: '/',
  }
}

/** "Sam finished the dishes. Next up: Alex." */
export function buildCompletedMessage(input: CompletedInput): PushMessage {
  const { choreSlug, choreName, completerName, nextName } = input
  const finished = `${completerName} finished the ${choreName.toLowerCase()}.`
  return {
    title: `${choreName} done`,
    body: nextName === completerName ? finished : `${finished} Next up: ${nextName}.`,
    tag: `chore-${choreSlug}`,
    url: '/',
  }
}
