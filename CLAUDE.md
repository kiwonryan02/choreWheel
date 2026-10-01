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
- `supabase/seed.sql` and `src/config/household.ts` describe the same household. Change them together.
- The anon key is public. It may only read: RLS gives `members`, `chores`, `chore_rotation` and `activity` a
  select policy and gives `bumps` and `push_subscriptions` none. All writes go through security-definer RPCs or Edge Functions.
- **Never add a sender column to `bumps`.** Anonymity is a hard requirement.
- Secrets (Supabase keys, passcode, VAPID keys) live in `.env` / Supabase env vars. Never commit them.

## Milestone status
1. Scaffold, schema + seed, static wheels — done
2. Realtime state, atomic `complete_chore` RPC, completion sheet, rotation animation — next
3. Identity picker + passcode gate
4. PWA install + Web Push for completions
5. Anonymous bump with rate limit
6. Activity feed, polish, Vercel deploy, README

Throwaway scaffolding to remove in M2/M3 is marked with `TODO(M2)` / `TODO(M3)` comments.
