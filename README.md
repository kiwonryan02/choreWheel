# Lack App

A mobile-first web app for a four-person household: two chore wheels (Dishes, Trash), a shared todo list, and a
live activity feed. Installs to the home screen and sends push notifications. State is shared live across everyone's
phones.

- **Chores:** each wheel always shows one person on top: whoever is responsible. They mark it done and the wheel turns
  to the next person. Everyone else can send an **anonymous nudge** ("bump").
- **Todos:** a shared list. Anyone adds and checks off; only the creator deletes (while it's open).
- **Activity:** one feed of everything completed, chores and todos together. Nudges never appear in it.
- **Notifications:** a ping when a chore or todo is finished, and a private nudge ping to whoever is on a chore.
- **No accounts.** Access is an unguessable URL plus a household passcode; each device picks who it is.

The full spec is in [docs/SPEC.md](docs/SPEC.md) (with a note at the top on where we deliberately differ from it).
Project conventions and design decisions live in [CLAUDE.md](CLAUDE.md).

## How it fits together

| Piece | What it does |
|---|---|
| **Vite + React + TypeScript + Tailwind** (bun) | The app. A PWA: manifest, icons, and a push-only service worker that caches nothing |
| **Supabase Postgres** | All state. The public (anon) key can only **read**; every write is an RPC that checks the household passcode |
| **Supabase Realtime** | Instant updates to wheels, todos and the feed |
| **`notify` Edge Function** | Sends Web Push (VAPID). Called by the app after a completion, check-off, or bump; each event is claimed once so it can't be spammed |
| **Vercel** | Hosts the frontend |

## Set up from scratch

You need: [bun](https://bun.sh), the [Supabase CLI](https://supabase.com/docs/guides/cli), a Supabase account and a
Vercel account (both free tiers are plenty).

### 1. Install

```bash
bun install
```

### 2. Make it yours

- **People:** edit `supabase/seed.sql`: names, colors, and each wheel's rotation order (each chore has its own order).
- **Chores:** emoji and the "done when" checklists are in `src/config/chores.ts`.

### 3. Create the Supabase project

Create a project at supabase.com. Note its **Project URL**, its **public key** (anon / publishable), and its
**project ref** (the `abc…` in `https://abc….supabase.co`). Never use the `service_role` key in the app.

### 4. Run the database migrations

In the Supabase dashboard open **SQL Editor** and run each file in `supabase/migrations/`, **in filename order**,
then `supabase/seed.sql`:

| Migration | Adds |
|---|---|
| `…0000_init.sql` | Tables, read-only access for the public key, Realtime |
| `…0100_complete_chore.sql` | The atomic "mark done" function |
| `…0200_passcode.sql` | The passcode gate and wrong-guess lockout |
| `…0300_push.sql` | Push subscriptions |
| `…0400_bump.sql` | Anonymous bump (12-hour global limit) and the nudge banner |
| `…0500_activity_feed.sql` | The generalized activity table (chores and todos) |
| `…0600_todos.sql` | The todo list and its functions |
| `…0700_todo_notifications.sql` | Once-only todo notifications |

Some of these contain `drop`/`rename`/`update`; the editor will ask you to confirm. Migrations are applied by hand;
the CLI has no SQL command and database commands need your DB password. Never edit a migration you've already run: add a
new one.

### 5. Set the household passcode

Pick a 4-6 digit passcode and run it in the SQL editor (don't put it in a file or share it in chat):

```sql
select set_household_passcode('123456');
```

Run it again any time to change it. Devices with the old one are asked for the new one on their next action.

### 6. Configure the app

```bash
cp .env.example .env
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Then generate a **VAPID keypair** for push:

```bash
bunx web-push generate-vapid-keys --json
```

Put the public key in `.env` as `VITE_VAPID_PUBLIC_KEY`. Create `supabase/push-secrets.local` (gitignored) with
the secrets for the Edge Function:

```
VAPID_PUBLIC_KEY=…
VAPID_PRIVATE_KEY=…
VAPID_SUBJECT=https://your-site-or-a-mailto-address
```

Never commit that file or share the private key. More detail and troubleshooting: [docs/PUSH_SETUP.md](docs/PUSH_SETUP.md).

### 7. Deploy the notification function

```bash
supabase login
supabase functions deploy notify --no-verify-jwt --use-api --project-ref YOUR-PROJECT-REF
supabase secrets set --env-file supabase/push-secrets.local --project-ref YOUR-PROJECT-REF
```

`--no-verify-jwt` is required (the app uses a publishable key, which isn't a JWT). Redeploy it whenever
`supabase/functions/notify/` changes, **after** running any migration it depends on.

### 8. Deploy the app to Vercel

Phones need HTTPS for installing and push, so this isn't optional. Give the project an **unguessable name**: the
address is part of the household's access control (the other part is the passcode).

```bash
bunx vercel@latest login
bunx vercel@latest link --yes --project lack-$(openssl rand -hex 4)
for K in VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY VITE_VAPID_PUBLIC_KEY; do
  printf '%s' "$(grep "^$K=" .env | cut -d= -f2-)" | bunx vercel@latest env add "$K" production --yes
done
bunx vercel@latest deploy --prod --yes
```

Redeploy with the last command whenever the app changes (the env vars are baked in at build time, so changing one needs a
redeploy). Keep the resulting URL out of anything public, and consider making the GitHub repo private.

### 9. Put it on the phones

- **iPhone/iPad (iOS 16.4+):** open the URL in **Safari**, tap Share, then **Add to Home Screen**. Open it from the home
  screen icon, enter the passcode, pick your name, and tap **Enable notifications**. Notifications don't work from a plain
  Safari tab.
- **Android:** open it in Chrome, enter the passcode, pick your name, tap **Enable notifications** (installing is optional).

To test notifications you need two devices, because the person who does something never gets pinged about it.

## Everyday use

```bash
bun run dev      # http://localhost:5173 (talks to your real Supabase project)
bun run build    # typecheck + production build
bun run lint
bun test         # the SQL, the service worker, and the message text (see below)
```

`supabase/dev-reset.sql` puts both wheels back on the first person and clears the activity and nudge history. Run it
in the SQL editor after testing.

## Security model

- The public key can read members, chores, rotations, todos and the feed, and **nothing else**. Writes, nudges, push
  subscriptions and the passcode are only reachable through functions that check the passcode on the server.
- Wrong passcode guesses are throttled for the whole household: 10 in 15 minutes locks all guesses until the window
  clears. (So anyone who finds the URL and key can lock everyone out for 15 minutes at a time. That's the trade for not
  having accounts.)
- **Nudges are anonymous by construction.** The table and function have no sender field at all, the limit is one nudge per
  chore per 12 hours for everyone, and tests fail if an identifying column or argument is ever added. (Platform request
  logs still see IP addresses, like any hosted API.)
- The `notify` function is callable with the public key by design; it can only announce a real, recent event, once.

## Testing

`bun test` runs the real migrations and seed in an in-process Postgres (PGlite) and checks every function's outcomes,
the permission model, history surviving the activity migration, the service worker against a fake scope, and the
notification wording. It is **not** Supabase: it can't check Realtime, PostgREST, or truly simultaneous transactions
(row locks make those safe, and the double-completion race was verified once against a live project). Every new migration
needs matching tests. See [CLAUDE.md](CLAUDE.md) for what has and hasn't been verified on real devices.

## Project layout

```
src/
  screens/      Home (shell + tabs), WheelsScreen, TodosScreen, ActivityScreen, PasscodeGate, WhoAreYou
  components/   Wheel, ChoreCard, CompletionSheet, TabBar, banners, SettingsMenu
  data/         one hook per concern: useHousehold, useTodos, useActivity, useNudges, usePush, bump, passcode
  lib/          supabase client, storage, push helpers, time
  config/       per-chore emoji and checklists
public/         manifest, service worker, icons
supabase/
  migrations/   run in order, by hand
  functions/    notify/ (the Edge Function) and its message text
  seed.sql      people, chores, rotation orders
tests/          SQL (PGlite), service worker, message text
docs/           the spec and push setup
```

## Things to know

- **Supabase's free plan pauses a project after about a week with no activity** (check their current policy). A paused
  project makes the app show "Couldn't load"; resume it from the dashboard.
- A completion ping can be lost if the finisher's phone dies in the instant between recording and announcing it. The
  chore itself is never lost.
- The nudge limit is per chore and ignores who is targeted, so a nudge aimed at the previous holder also blocks nudging the
  new holder until the 12 hours pass.

## Future ideas (not in v1)

Accounts/login, multiple households, skip/swap/vacation mode, scheduled chore reminders, stats and leaderboards,
editing todos, and letting someone mark a chore done on another person's behalf (there's a marked TODO for that edge case).
