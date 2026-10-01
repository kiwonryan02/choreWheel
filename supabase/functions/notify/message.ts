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
