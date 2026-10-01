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
   (`complete_chore` has no passcode check until M3; the `activity` feed/subscription arrives in M6)
3. Identity picker + passcode gate — next
4. PWA install + Web Push for completions
5. Anonymous bump with rate limit
6. Activity feed, polish, Vercel deploy, README

Throwaway scaffolding to remove in M2/M3 is marked with `TODO(M2)` / `TODO(M3)` comments.
