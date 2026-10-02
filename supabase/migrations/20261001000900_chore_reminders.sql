-- Automatic reminder: if a chore has sat with the same person for 4 days, nudge
-- them ONCE for that turn.
--
-- How it runs: pg_cron calls send_stale_chore_reminders() every 30 minutes. That
-- function records a reminder for each chore whose current turn is 4+ days old
-- (at most one per turn, ever), then asks the notify Edge Function (via pg_net)
-- to send it. The notify function claims each reminder once and pings only the
-- person who is still on the chore. Reminders are sent only during the day in
-- the household's timezone; one that comes due overnight goes out in the morning.
--
-- One-time setup after running this migration (SQL editor, by hand):
--     select configure_reminders('https://YOUR-REF.supabase.co/functions/v1/notify', 'America/New_York');
-- Until that has been run, nothing is sent and nothing is recorded.

-- ---------------------------------------------------------------------------
-- The scheduler and HTTP extensions. Guarded so the migration still applies on a
-- plain Postgres (the test database has neither).
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule(
      'stale-chore-reminders',
      '*/30 * * * *',
      'select public.send_stale_chore_reminders()'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Settings (set by hand via configure_reminders) and the reminders themselves.
-- Neither is reachable with the public key.
-- ---------------------------------------------------------------------------

create table app_settings (
  key    text primary key,
  value  text not null
);
alter table app_settings enable row level security;
revoke all on app_settings from anon, authenticated;

create table chore_reminders (
  id                uuid primary key default gen_random_uuid(),
  chore_id          uuid not null references chores (id) on delete cascade,
  member_id         uuid not null references members (id),
  -- chores.updated_at when this person's turn began. Unique per chore, so each
  -- turn is reminded about at most once however many times the job runs.
  stint_started_at  timestamptz not null,
  created_at        timestamptz not null default now(),
  notified_at       timestamptz,
  unique (chore_id, stint_started_at)
);
create index chore_reminders_unsent_idx on chore_reminders (created_at) where notified_at is null;
alter table chore_reminders enable row level security;
revoke all on chore_reminders from anon, authenticated;

-- ---------------------------------------------------------------------------
-- configure_reminders(notify_url, timezone): run by hand, never by the app.
-- ---------------------------------------------------------------------------

create or replace function configure_reminders(p_notify_url text, p_timezone text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_notify_url is null or p_notify_url !~ '^https://' then
    raise exception 'the notify url must start with https://';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'unknown timezone %, use a name like America/New_York', p_timezone;
  end if;

  insert into app_settings (key, value)
  values ('notify_url', p_notify_url), ('reminder_timezone', p_timezone)
  on conflict (key) do update set value = excluded.value;
end;
$$;
revoke all on function configure_reminders(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- send_stale_chore_reminders(now): what the scheduler runs. `p_now` exists so
-- tests can pick the time; the scheduler uses the default. Returns how many
-- requests it sent.
--
--   * not configured: does nothing at all (and records nothing, so nothing is lost)
--   * outside 08:00-23:00 household time: does nothing; the next run in the window
--     picks it up
--   * records a reminder for every chore whose current turn is 4+ days old
--   * asks notify to send every reminder not yet claimed (so a failed request is
--     retried on the next run), for up to a day
-- ---------------------------------------------------------------------------

create or replace function send_stale_chore_reminders(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url    text;
  v_tz     text;
  v_hour   int;
  v_posted int := 0;
  r        record;
begin
  select s.value into v_url from app_settings s where s.key = 'notify_url';
  select s.value into v_tz  from app_settings s where s.key = 'reminder_timezone';
  if v_url is null or v_tz is null then
    return 0;
  end if;

  v_hour := extract(hour from (p_now at time zone v_tz))::int;
  if v_hour < 8 or v_hour >= 23 then
    return 0;
  end if;

  insert into chore_reminders (chore_id, member_id, stint_started_at, created_at)
  select c.id, c.current_member_id, c.updated_at, p_now
    from chores c
   where c.updated_at <= p_now - interval '4 days'
  on conflict (chore_id, stint_started_at) do nothing;

  for r in
    select cr.id
      from chore_reminders cr
     where cr.notified_at is null
       and cr.created_at > p_now - interval '1 day'
     order by cr.created_at
  loop
    begin
      perform net.http_post(
        url  := v_url,
        body := jsonb_build_object('type', 'reminder', 'reminder_id', r.id)
      );
      v_posted := v_posted + 1;
    exception when others then
      -- Never let one failed request stop the rest; the next run retries it.
      raise warning 'could not request reminder %: %', r.id, sqlerrm;
    end;
  end loop;

  return v_posted;
end;
$$;
revoke all on function send_stale_chore_reminders(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- claim_reminder_notification(reminder_id): called ONLY by the notify Edge
-- Function (service_role). Claims the reminder exactly once and returns who to
-- ping and how long the chore has waited, but only if that person is STILL on
-- the chore and it is still the same turn. (`p_now` is for tests; notify uses the default.) If they did it (or the wheel moved)
-- in the meantime, nothing is sent.
-- ---------------------------------------------------------------------------

create or replace function claim_reminder_notification(p_reminder_id uuid, p_now timestamptz default now())
returns table (chore_slug text, chore_name text, recipient_id uuid, waiting_days int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_chore  uuid;
  v_member uuid;
  v_stint  timestamptz;
begin
  update chore_reminders r
     set notified_at = p_now
   where r.id = p_reminder_id
     and r.notified_at is null
  returning r.chore_id, r.member_id, r.stint_started_at into v_chore, v_member, v_stint;

  if not found then
    return;
  end if;

  return query
    select c.slug, c.name, v_member, floor(extract(epoch from (p_now - v_stint)) / 86400)::int
      from chores c
     where c.id = v_chore
       and c.current_member_id = v_member
       and c.updated_at = v_stint;
end;
$$;
revoke all on function claim_reminder_notification(uuid, timestamptz) from public, anon, authenticated;
grant execute on function claim_reminder_notification(uuid, timestamptz) to service_role;
