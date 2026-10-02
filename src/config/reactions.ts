// The reactions you can put on an activity entry. `kind` is what the database
// stores (and its CHECK allows); the emoji and label are presentation only.

export type ReactionKind = 'thumbs_up' | 'heart' | 'goat' | 'thanks'

export const REACTIONS: { kind: ReactionKind; emoji: string; label: string }[] = [
  { kind: 'thumbs_up', emoji: '👍', label: 'Thumbs up' },
  { kind: 'heart', emoji: '❤️', label: 'Heart' },
  { kind: 'goat', emoji: '🐐', label: 'Goat' },
  { kind: 'thanks', emoji: '🙏', label: 'Thank you' },
]
