# CLAUDE.md — Chore Wheel

Mobile-first PWA for 4 roommates (Kiwon, Lucas, Anish, Carter) with two chore wheels: Dishes and Trash.
The full build spec is [docs/SPEC.md](docs/SPEC.md). Its stack decisions are settled; don't relitigate them.

## Stack
Vite + React + TypeScript, **bun**, Tailwind v4, Supabase (Postgres + Realtime + Edge Functions), Web Push (VAPID), Vercel.

## Commands
- `bun run dev` — dev server (http://localhost:5173)
- `bun run build` — typecheck + production build
- `bun run lint` — oxlint

## Decisions that differ from or refine the spec
- **Rotation order is per chore**, not shared. Both wheels start on Kiwon, but Dishes goes
  Kiwon → Lucas → Anish → Carter and Trash goes Kiwon → Carter → Anish → Lucas. This is why the
  schema has a `chore_rotation(chore_id, member_id, position)` table. `members.position` is display order only.
- `supabase/seed.sql` is the source of truth for members, chores and rotation orders. `src/config/chores.ts`
  only holds per-chore presentation (emoji, checklist text).
- The anon key is public. It may only read: `members`, `chores`, `chore_rotation` and `activity` get a select
  policy **and an explicit `grant select`** (new Supabase projects don't auto-grant tables to anon); `bumps` and
  `push_subscriptions` get neither. All writes go through security-definer RPCs or Edge Functions.
- Migrations are applied by hand in the Supabase SQL editor (no CLI/DB credentials in this setup), in filename order.
  Never edit an already-applied migration; add a new one. `supabase/dev-reset.sql` resets test data and is not a migration.
- When testing against the live project, look up chore/member ids by slug/name; don't infer them from row order.
- **Never add a sender column to `bumps`.** Anonymity is a hard requirement.
- Secrets (Supabase keys, passcode, VAPID keys) live in `.env` / Supabase env vars. Never commit them.

## Milestone status
1. Scaffold, schema + seed, static wheels — done
2. Realtime state, atomic `complete_chore` RPC, completion sheet, rotation animation — done
   (the `activity` feed/subscription arrives in M6)
3. Identity picker + passcode gate — done
4. PWA install + Web Push for completions — next
5. Anonymous bump with rate limit
6. Activity feed, polish, Vercel deploy, README (also decide the spec's "unguessable URL" part of access)

Remaining work is marked with `TODO(M#)` comments.

## Passcode design (M3)
- Every write RPC takes the household passcode and checks it server-side via `check_passcode()`.
  The passcode is salted+hashed in `household_settings`; set it by hand with `select set_household_passcode('…')`
  in the SQL editor. Never ask for it in chat or write it to a file.
- Wrong guesses are throttled globally: 10 in 15 minutes locks all guesses (`passcode_failures`). Auth failures are
  returned as a **status value, not an exception**, because an exception would roll back the failure record.
  New write RPCs should follow the same pattern: `check_passcode()` first, return its status if not `'ok'`.
- Device state lives in localStorage: `chorewheel.passcode`, `chorewheel.memberId` (see `src/lib/storage.ts`).
- The 2-arg `complete_chore(uuid, uuid)` from the M2 migration was dropped in M3. The `TODO(M3)` comment left in
  the M2 migration is stale (applied migrations aren't edited).
