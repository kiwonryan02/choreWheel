-- Milestone 3: household passcode gate.
--
-- The anon key is public, so every write RPC takes the household passcode and
-- checks it here, server-side. Wrong guesses are throttled globally (there are
-- no accounts to throttle per person): after 10 wrong guesses in 15 minutes,
-- all guesses are refused until the window clears.
--
-- Failures are reported as a status value, never an exception: an exception
-- would roll back the transaction and erase the failure we just recorded.

-- ---------------------------------------------------------------------------
-- Storage (no policies and no grants: unreadable through the API)
-- ---------------------------------------------------------------------------

create table household_settings (
  id             boolean primary key default true check (id), -- singleton row
  passcode_salt  text not null,
  passcode_hash  text not null
);

create table passcode_failures (
  id            bigint generated always as identity primary key,
  attempted_at  timestamptz not null default now()
);
create index passcode_failures_attempted_at_idx on passcode_failures (attempted_at);

alter table household_settings enable row level security;
alter table passcode_failures  enable row level security;
revoke all on household_settings, passcode_failures from anon, authenticated;

-- ---------------------------------------------------------------------------
-- set_household_passcode(passcode): run by hand in the SQL editor, never by the
-- app. Choose your own 4-6 digit passcode:
--
--     select set_household_passcode('123456');
-- ---------------------------------------------------------------------------

create or replace function set_household_passcode(p_passcode text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_salt text := gen_random_uuid()::text; -- built in (no pgcrypto), random per passcode
begin
  if p_passcode is null or p_passcode !~ '^[0-9]{4,6}$' then
    raise exception 'passcode must be 4 to 6 digits';
  end if;

  insert into household_settings (id, passcode_salt, passcode_hash)
  values (true, v_salt, encode(sha256(convert_to(v_salt || p_passcode, 'UTF8')), 'hex'))
  on conflict (id) do update
    set passcode_salt = excluded.passcode_salt,
        passcode_hash = excluded.passcode_hash;

  delete from passcode_failures;
end;
$$;
revoke all on function set_household_passcode(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- check_passcode(passcode) -> 'ok' | 'invalid' | 'locked' | 'not_set'
-- Internal helper used by the public RPCs below.
-- ---------------------------------------------------------------------------

create or replace function check_passcode(p_passcode text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s household_settings%rowtype;
begin
  select * into s from household_settings;
  if not found then
    return 'not_set';
  end if;

  delete from passcode_failures where attempted_at < now() - interval '1 day';

  if (select count(*) from passcode_failures
       where attempted_at > now() - interval '15 minutes') >= 10 then
    return 'locked';
  end if;

  if s.passcode_hash is distinct from
     encode(sha256(convert_to(s.passcode_salt || coalesce(p_passcode, ''), 'UTF8')), 'hex') then
    insert into passcode_failures default values;
    return 'invalid';
  end if;

  return 'ok';
end;
$$;
revoke all on function check_passcode(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- verify_passcode(passcode): what the passcode screen calls.
-- ---------------------------------------------------------------------------

create or replace function verify_passcode(p_passcode text)
returns text
language sql
security definer
set search_path = public, pg_temp
as $$
  select check_passcode(p_passcode);
$$;
revoke all on function verify_passcode(text) from public;
grant execute on function verify_passcode(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- complete_chore now requires the passcode. Same compare-and-set as before, but
-- it reports a status: 'done' | 'stale' | 'invalid' | 'locked' | 'not_set'.
--
-- The old unauthenticated 2-argument version is dropped so it can't be called.
--
-- TODO(v1 edge case, out of scope): someone else did the chore on the person's
-- behalf. Today only the person on top can complete it; there is no "complete
-- for someone else" path.
-- ---------------------------------------------------------------------------

drop function if exists complete_chore(uuid, uuid);

create or replace function complete_chore(
  p_passcode             text,
  p_chore_id             uuid,
  p_expected_member_id   uuid
)
returns table (status text, up_now uuid, since timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth  text;
  v_pos   int;
  v_next  uuid;
  v_since timestamptz;
begin
  v_auth := check_passcode(p_passcode);
  if v_auth <> 'ok' then
    return query select v_auth, null::uuid, null::timestamptz;
    return;
  end if;

  perform 1
    from chores
   where id = p_chore_id
     and current_member_id = p_expected_member_id
     for update;

  if not found then
    -- Someone else already completed it (or the id is wrong): report the
    -- current state so the caller can reconcile.
    return query
      select 'stale', c.current_member_id, c.updated_at
        from chores c
       where c.id = p_chore_id;
    return;
  end if;

  select r.position into v_pos
    from chore_rotation r
   where r.chore_id = p_chore_id
     and r.member_id = p_expected_member_id;

  if v_pos is null then
    raise exception 'member % is not in the rotation for chore %', p_expected_member_id, p_chore_id;
  end if;

  -- Next position after v_pos, wrapping around to the first.
  select r.member_id into v_next
    from chore_rotation r
   where r.chore_id = p_chore_id
   order by (r.position <= v_pos), r.position
   limit 1;

  v_since := now();

  update chores
     set current_member_id = v_next,
         updated_at = v_since
   where id = p_chore_id;

  insert into activity (chore_id, member_id, completed_at)
  values (p_chore_id, p_expected_member_id, v_since);

  return query select 'done', v_next, v_since;
end;
$$;

revoke all on function complete_chore(text, uuid, uuid) from public;
grant execute on function complete_chore(text, uuid, uuid) to anon, authenticated;
