# CLAUDE.md — Chore Wheel

Mobile-first PWA for 4 roommates (Kiwon, Lucas, Anish, Carter) with two chore wheels: Dishes and Trash.
The full build spec is [docs/SPEC.md](docs/SPEC.md). Its stack decisions are settled; don't relitigate them.

## Stack
Vite + React + TypeScript, **bun**, Tailwind v4, Supabase (Postgres + Realtime + Edge Functions), Web Push (VAPID), Vercel.

## Commands
- `bun run dev` — dev server (http://localhost:5173)
- `bun run build` — typecheck + production build
- `bun run lint` — oxlint (the `react/set-state-in-effect` rule is off on purpose: our data hooks load on mount and
  call setState after an `await`, which that rule can't distinguish from a synchronous call)
- `bun test` — SQL (PGlite), service worker, message tests

## Decisions that differ from or refine the spec
- **The app's display name is "Lack App"** (header, passcode screen, page title, PWA manifest `name` and `short_name`, iOS
  home-screen title, the service worker's fallback notification title). It was "LACK Chore Wheel" until the owner renamed it.
  The first tab is called **Chores** (it shows the wheels). Use the name for the PWA manifest
  `name` in M4 and for push notification titles.
- **The chore checklist is shown on each wheel's card**, always visible, as a plain numbered list. The completion sheet
  is only a confirm ("Mark dishes done? The wheel will move on to X"). The spec had the checklist in the sheet with tickable boxes.
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
4. PWA install + Web Push for completions — `notify` is deployed (project `hurozxaezghiiwmzxwah`) and smoke-tested;
   a real-device push test is still pending until the app is on HTTPS (see [docs/PUSH_SETUP.md](docs/PUSH_SETUP.md))
5. Anonymous bump with rate limit — done and live (real-device test of the pings passed)
6. Activity feed (generalized `activity` table) + bottom tab bar — done and live
7. Shared todo list (+ pushes when a todo is checked off) — done and live (migrations `…0500`-`…0700` run, `notify` and
   the app redeployed); a real-device test of the todo pings is still pending
8. Polish and README with full setup steps — done (README covers setup from scratch; lint warnings resolved; iOS tap delay removed)

(The repo's `docs/SPEC.md` is the updated spec: milestones 6-8 and the todo list. Its older lines that we deliberately
differ from are listed in the note at its top.)

Remaining work is marked with `TODO(M#)` comments.

## Deployment (Vercel)
- Deployed with the Vercel CLI from the local working tree, **not** connected to GitHub (connecting needs the Vercel GitHub
  app installed on the repo). Redeploy with `bunx vercel@latest deploy --prod --yes` from the repo root.
  `.vercel/` (gitignored) holds the project link; the project name is `lack-wheel-` + random hex.
- Production env vars (set with `vercel env add … production`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
  `VITE_VAPID_PUBLIC_KEY`. They're baked in at build time, so changing one needs a redeploy.
- **The production URL is the "unguessable URL" half of access, so never write it into a committed file, a PR, or an
  issue.** The GitHub repo is currently **public** (it contains the roommates' first names and the Supabase project ref),
  so the URL must stay out of it. Making the repo private is recommended.
- Vercel runs Standard deployment protection: the production alias is public; per-deployment URLs require a Vercel login.

## PWA and push design (M4)
- `public/sw.js` handles push + notification clicks only and **caches nothing** (so there is never a stale build).
  `public/manifest.webmanifest`: `name` and `short_name` both "Lack App" (home-screen labels truncate
  around 11 characters, and this fits). Icons are rendered from `public/icons/icon.svg`.
- Notifications are **triggered by the app, not a database trigger**: after `complete_chore` returns `activity_id`, the app
  calls the `notify` Edge Function, which claims the row via `activity.notified_at` so it notifies at most once. No pg_net
  or webhook secret is needed. Trade-off: if the completer's app dies between the two calls, that one ping is lost.
- The completer's devices are skipped. Subscriptions are filed per member and re-filed when someone switches person.
- The bump notification reuses the same pattern: `notify` claims a `bumps` row once (`bumps.notified_at`), sends only to
  the target member, and its message names no one.

## Feed, tabs and todos (M6-M7)
- `activity(id, kind, member_id, chore_id null, todo_id null, created_at, notified_at)`: `kind` is `'chore'` or `'todo'`;
  a CHECK enforces exactly one subject matching the kind. `completed_at` was renamed to `created_at` (existing history is
  backfilled as `kind = 'chore'`, tested). `complete_chore` was replaced in the same migration because it inserts into
  `activity`. Anything new that reads or writes `activity` must use `created_at` and set `kind`.
- Todo writes are passcode-checked RPCs returning a status (never an exception): `create_todo`, `set_todo_done` (idempotent,
  row-locked: simultaneous check-offs write exactly one feed entry; **unchecking deletes the entry**), `delete_todo`
  (creator only, open only). Creating a todo is not logged. The public key can only read `todos`.
- **Todo check-offs send a push to everyone except the person who checked it off** ("Alex checked off 'Buy paper towels'").
  The spec said to leave this out of v1; the owner later asked for it. After `set_todo_done` returns `ok` for a check-off,
  the app calls `notify` with `{ type: 'todo_done', todo_id }`; `claim_todo_notification` (service_role only) claims the
  todo's newest unannounced feed entry once, and returns nothing if it was unchecked meanwhile. Unchecking sends nothing.
- The feed (`useActivity`) reloads its page of 50 entries on any Realtime insert/delete (simple and always consistent);
  todo text comes from a PostgREST embed (`todos(text)`).
- Tabs (Chores / Todos / Activity) are all kept mounted and just hidden, so each keeps its state and live connection; the
  page scroll resets on a tab change. The Todos tab badge is the open-todo count.
- The app now checks the saved passcode on load (the nudge poll), so a made-up passcode in localStorage is rejected at once
  (and counts as a wrong guess). To eyeball the UI without the real passcode, load the app in a same-origin iframe with the
  `get_nudges` RPC stubbed; don't add test-only code to the app.

## Reactions on the feed
- `reactions(activity_id, member_id, kind)`, primary key on all three: a person can use several different reactions on an entry
  but each once. Kinds are `thumbs_up`, `heart`, `goat`, `thanks` (👍 ❤️ 🐐 🙏), enforced by a CHECK; the emoji live in
  `src/config/reactions.ts`. Reactions are **visible and attributed** (unlike bumps): the chips show counts, and the names are
  in each chip's tooltip/aria-label.
- `set_reaction(passcode, activity_id, member_id, kind, on)` is idempotent and status-returning, like the todo RPCs; the public
  key can only read `reactions`. Reactions cascade-delete with their feed entry (unchecking a todo removes both).
- The feed reloads on any Realtime activity/reaction insert or delete; our own reactions are applied optimistically first.
- No notifications for reactions.

## Bump design (M5)
- `bump_chore(passcode, chore_id, expected_member_id)` takes **no sender**, and `bumps` has **no sender column**.
  `tests/sql/bump.test.ts` pins the exact column list and function arguments, so adding an identifying field fails a test.
  Platform request logs (Supabase/Vercel) still see IPs like any hosted API; the guarantee is that **no row, API response,
  or notification** can reveal the bumper.
- Rate limit: at most 1 bump per **chore** per **12 hours** (the spec said 6; the owner chose 12), global, **regardless of
  who is bumping or who is targeted**. The owner considered a per-person limit and rejected it: enforcing one would
  mean recording the bumper, which breaks anonymity (and a bumper who had hit three people would be identifiable by
  elimination). A bump aimed at the previous holder also blocks bumping the new holder until the 12 hours pass.
- **Who gets pinged is decided in the database**: `claim_bump_notification(bump_id)` (service_role only) claims a bump once and
  returns the recipient only if they are *still* on the chore. If the wheel moved on first, nobody is notified. The `notify`
  function only sends to that one person's subscriptions.
- The recipient's in-app "Friendly nudge" banner comes from `get_nudges` (passcode-checked): bumps during their current
  stint, within 12 hours. Dismissals are per device in localStorage (`chorewheel.nudgeSeen.<chore id>`). `bumps` itself
  stays unreadable by the public key and isn't on Realtime, so the app polls (load, foreground, wheel change, every 60s).
  On an `invalid` passcode the polling stops and the passcode is cleared, so it can't burn through the lockout.
- Secrets: `supabase/push-secrets.local` (gitignored, holds the VAPID private key) is pushed to Supabase with
  `supabase secrets set --env-file`. Never print it or paste it into chat.
- The Edge Function can't run locally (no Deno), and the in-app browser can't run service workers or push.
  `tests/` covers the SQL, the message text, the service worker (against a fake scope) and the key decoding. Against
  the live project, `notify` was smoke-tested (CORS preflight, bad input, DB claim as service_role), and `web-push`
  signing + encryption + HTTPS send under Deno was proven with a throwaway probe function (since deleted) that pushed to
  a fake device and got the expected HTTP 400 back. What has **not** been seen: a push arriving on a real device, and
  the service worker registering in a real browser.
- Deploy: `supabase functions deploy notify --no-verify-jwt --use-api --project-ref <ref>` then
  `supabase secrets set --env-file supabase/push-secrets.local --project-ref <ref>`. The CLI has no SQL command and
  needs the DB password for db commands, so **migrations still go through the SQL editor**.

## Tests
`bun test` runs everything in `tests/`. The SQL tests run the real migrations + seed in PGlite (in-process Postgres) with
stub roles. It is not Supabase: it can't check Realtime, pg extensions, PostgREST, or true concurrent transactions
(the double-completion race was checked once against the live project). The stub `service_role` bypasses RLS like the
real one. **Every new migration needs matching tests.**

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
