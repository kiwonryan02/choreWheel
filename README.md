# LACK Chore Wheel

A mobile-first web app for four roommates with two chore wheels (Dishes, Trash). Whoever is on top owns the
chore. They mark it done and the wheel rotates to the next person, live on everyone's phone.

Status: Milestone 1 of 6. Static wheels render from a local config. Supabase wiring, passcode,
notifications and deploy come in the later milestones. See [docs/SPEC.md](docs/SPEC.md) for the full spec and
[CLAUDE.md](CLAUDE.md) for project conventions.

## Develop

```bash
bun install
bun run dev    # http://localhost:5173
bun test       # SQL (in-process Postgres), service worker, message text
```

Copy `.env.example` to `.env` and fill it in. Push notifications need a one-time setup: see
[docs/PUSH_SETUP.md](docs/PUSH_SETUP.md).

## Future ideas (not in v1)

Accounts/login, multiple households, skip/swap/vacation mode, scheduled chore reminders, stats and leaderboards.

Full setup docs (Supabase project, VAPID keys, env vars, Vercel) land with Milestone 6.
