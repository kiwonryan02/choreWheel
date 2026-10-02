# Roommate Chore Wheel — Build Spec

## Goal
A mobile-first web app for 4 roommates with two chore wheels (Dishes, Trash). Each wheel always shows one person at the top: whoever is currently responsible. When they finish the chore, they mark it done and the wheel rotates to the next person. State is live and shared across everyone's phones.

## Stack (decisions made, don't relitigate)
- Vite + React + TypeScript, bun, Tailwind
- Supabase (Postgres + Realtime) for shared live state; free tier is plenty
- PWA (manifest + service worker) so it installs to the home screen and can receive push
- Web Push (VAPID) sent from a Supabase Edge Function
- Deploy frontend to Vercel
- No user accounts. Access is by a shared household link/passcode (see Identity)

## Core concepts
- **Members:** 4 fixed people with a name, color, and a fixed rotation order. Seeded from a config file / seed SQL (names to be filled in by me).
- **Chores:** `dishes` and `trash`. Each has a `current_member_id` (the person on top) and the rotation order is shared (same 4 people, same order), but each wheel advances independently.
- **Rotation:** completing a chore sets `current_member_id` to the next member in order, wrapping around.

## Chore definitions (shown in the completion sheet)
**Trash** — done means all of:
1. Swept the living room and kitchen for loose trash
2. Bagged all trash in the trash area
3. Left the bags by the door

**Dishes** — done means all of:
1. Cleared the dishwasher (only if it was clean)
2. Cleared all dishes from the sink and kitchen, by loading the dishwasher or hand-washing
3. Ran the dishwasher (only if it was full)

## Screens
1. **Home:** two wheels stacked vertically (swipe or scroll). Each wheel is a circular dial with the 4 names around it, current person rotated to the top and highlighted. Under each wheel: "Up now: <name>", time since they became responsible, and the primary action button.
   - If I am the person on top: **"Mark done"** button.
   - If I am not: **"Bump <name>"** button (anonymous nudge).
2. **Completion sheet** (bottom sheet): shows the checklist for that chore (above) as a reference for what "done" means. Items are tappable checkboxes for the person's own convenience, but nothing is required: "Confirm" is always enabled, and no checkbox state is validated or stored. On confirm, the wheel animates a rotation to the next person.
3. **Activity feed:** reverse-chronological log ("Sam did the dishes · 2h ago"). Bumps are NOT shown here (anonymity).
4. **Who are you?** first-launch picker: tap your name; stored in localStorage. Changeable from a small settings menu.

## Identity and access
- Household access via an unguessable URL plus a 4–6 digit passcode entered once per device (stored in localStorage). Passcode is checked server-side by Edge Functions / RPCs; the anon key alone should not allow writes.
- Per-device identity is a picker (no login). Acceptable because this is 4 trusted roommates.
- Only the person currently on top can complete that chore. Edge case (someone else did it for them): out of scope for v1 — leave a clearly marked TODO.

## Live state
- Supabase Realtime subscription on `chores` and `activity` tables so every phone updates instantly without refresh.
- Completion is an atomic RPC: `complete_chore(chore_id, expected_member_id)`. It only advances if `current_member_id = expected_member_id`, preventing double-advance if two taps/devices race. Writes an activity row in the same transaction.
- Optimistic UI, reconcile on realtime event.

## Notifications
- On chore completion: push to everyone (including the completer is fine, but make the completer's copy quiet or skip it): "Sam finished the dishes. Next up: Alex."
- On anonymous bump: push only to the person currently on top: "Friendly nudge: the trash is waiting on you."
- Implementation: push subscriptions stored per member + device in `push_subscriptions`. Edge Function sends via web-push with VAPID keys from env vars.
- iOS requires the app be installed to the Home Screen (iOS 16.4+) for push. Include a first-run banner with instructions to Add to Home Screen, and a "Enable notifications" button that triggers the permission prompt from a user gesture.
- Fallback if push isn't enabled: the app still works; state is live while open.

## Anonymous bump rules
- Server never records who bumped. The bump RPC stores only `chore_id`, `target_member_id`, `created_at`.
- The person on top can't see a bump button for themselves.
- Rate limit globally per chore (not per person, to preserve anonymity): max 1 bump per chore per 6 hours (changed to 12 hours by the owner; see CLAUDE.md). If limited, show "Someone already nudged them recently."
- Recipient sees nothing in the activity feed; just the push and an optional "You were nudged" banner in-app.

## Data model (Postgres)
- `members(id, name, color, position)`
- `chores(id, slug, name, current_member_id, updated_at)`
- `activity(id, chore_id, member_id, completed_at)`
- `bumps(id, chore_id, target_member_id, created_at)`
- `push_subscriptions(id, member_id, endpoint, p256dh, auth, created_at)`
- RLS on; all writes go through RPCs/Edge Functions that validate the household passcode.

## Non-goals (v1)
- Accounts/login, multiple households, skip/swap/vacation mode, chore reminders on a schedule, stats/leaderboards. Mention as future ideas in the README only.

## Milestones
1. Scaffold app, Supabase schema + seed, Home screen with static wheels
2. Realtime state + atomic complete RPC + completion sheet + rotation animation
3. Identity picker + passcode gate
4. PWA install + Web Push for completion notifications
5. Anonymous bump with rate limit
6. Activity feed, polish, deploy to Vercel, README with setup steps (Supabase project, VAPID keys, env vars)

## Acceptance checks
- Two phones open: completing on one rotates the wheel on the other within ~1s.
- Two rapid completes from the same state advance the wheel only once.
- Bump notifies only the person on top, and nothing in the DB or UI reveals the sender.
- All 4 members can see both wheels; only the person on top gets "Mark done".
- Works as an installed PWA on iOS and Android.

## Open items for Claude Code to confirm with me before building
- The 4 names and rotation order
- Whether the two wheels should share a rotation starting point or start at different people (default: different, so the same person isn't on both)
