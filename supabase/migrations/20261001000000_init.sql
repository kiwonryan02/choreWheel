-- Chore Wheel: initial schema (Milestone 1).
-- RPCs (complete_chore, bump_chore, passcode checks) arrive in later milestones.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table members (
  id        uuid primary key default gen_random_uuid(),
  name      text not null unique,
  color     text not null,
  -- Display order only (e.g. the "Who are you?" picker). Rotation order is
  -- per chore, see chore_rotation.
  position  int  not null unique
);

create table chores (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique,
  name               text not null,
  current_member_id  uuid not null references members (id),
  -- Bumped whenever current_member_id changes: "time since they became responsible".
  updated_at         timestamptz not null default now()
);

-- Each wheel has its own rotation order over the same four members.
create table chore_rotation (
  chore_id   uuid not null references chores (id) on delete cascade,
  member_id  uuid not null references members (id),
  position   int  not null,
  primary key (chore_id, member_id),
  unique (chore_id, position)
);

create table activity (
  id            uuid primary key default gen_random_uuid(),
  chore_id      uuid not null references chores (id),
  member_id     uuid not null references members (id),
  completed_at  timestamptz not null default now()
);
create index activity_completed_at_idx on activity (completed_at desc);

-- Anonymity: deliberately no column for who bumped. Do not add one.
create table bumps (
  id                uuid primary key default gen_random_uuid(),
  chore_id          uuid not null references chores (id),
  target_member_id  uuid not null references members (id),
  created_at        timestamptz not null default now()
);
create index bumps_chore_created_idx on bumps (chore_id, created_at desc);

create table push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references members (id),
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row level security
-- The anon key is public (it ships in the frontend bundle), so it may only
-- read. Every write goes through RPCs / Edge Functions that check the
-- household passcode and run as security definer.
-- ---------------------------------------------------------------------------

alter table members            enable row level security;
alter table chores             enable row level security;
alter table chore_rotation     enable row level security;
alter table activity           enable row level security;
alter table bumps              enable row level security;
alter table push_subscriptions enable row level security;

create policy "anon can read members"        on members        for select to anon, authenticated using (true);
create policy "anon can read chores"         on chores         for select to anon, authenticated using (true);
create policy "anon can read chore_rotation" on chore_rotation for select to anon, authenticated using (true);
create policy "anon can read activity"       on activity       for select to anon, authenticated using (true);
-- bumps and push_subscriptions get no policies: unreadable by the anon key.

-- Defense in depth: strip write privileges even if a policy is added by mistake.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on bumps, push_subscriptions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: phones subscribe to chores + activity.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table chores, activity;
