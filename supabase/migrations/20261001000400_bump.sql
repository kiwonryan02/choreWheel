-- Milestone 5: anonymous bump.
--
-- ANONYMITY RULE: nothing here may record who bumped. bump_chore takes no
-- sender argument and the bumps table has no sender column. Do not add either;
-- tests/sql/bump.test.ts fails if the table gains an unexpected column.

-- Same once-only claim the notify function uses for completions.
alter table bumps add column notified_at timestamptz;

-- The notify function (service_role) claims a bump, so it needs these.
grant select, update on bumps to service_role;

-- ---------------------------------------------------------------------------
-- bump_chore(passcode, chore_id, expected_member_id)
--   -> 'sent' | 'rate_limited' | 'stale' | 'invalid' | 'locked' | 'not_set'
--
-- expected_member_id is the person the caller sees on top; if the wheel has
-- moved on, the answer is 'stale' and nothing is recorded. The rate limit is
-- global per chore (never per person, which would identify bumpers): at most
-- one bump per chore per 6 hours. Locking the chore row makes two simultaneous
-- bumps take turns, so the limit can't be raced.
-- ---------------------------------------------------------------------------

create or replace function bump_chore(
  p_passcode             text,
  p_chore_id             uuid,
  p_expected_member_id   uuid
)
returns table (status text, bump_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth text;
  v_bump uuid;
begin
  v_auth := check_passcode(p_passcode);
  if v_auth <> 'ok' then
    return query select v_auth, null::uuid;
    return;
  end if;

  perform 1
    from chores
   where id = p_chore_id
     and current_member_id = p_expected_member_id
     for update;

  if not found then
    return query select 'stale', null::uuid;
    return;
  end if;

  if exists (
    select 1 from bumps b
     where b.chore_id = p_chore_id
       and b.created_at > now() - interval '6 hours'
  ) then
    return query select 'rate_limited', null::uuid;
    return;
  end if;

  insert into bumps (chore_id, target_member_id)
  values (p_chore_id, p_expected_member_id)
  returning id into v_bump;

  return query select 'sent', v_bump;
end;
$$;

revoke all on function bump_chore(text, uuid, uuid) from public;
grant execute on function bump_chore(text, uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_nudges(passcode, member_id): powers the in-app "you were nudged" banner.
-- Returns the chores this member is on top of that were bumped during their
-- current stint (and within the last 6 hours). It says that a nudge happened,
-- never by whom: the data doesn't exist.
-- ---------------------------------------------------------------------------

create or replace function get_nudges(p_passcode text, p_member_id uuid)
returns table (status text, chore_id uuid, nudged_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth text;
begin
  v_auth := check_passcode(p_passcode);
  if v_auth <> 'ok' then
    return query select v_auth, null::uuid, null::timestamptz;
    return;
  end if;

  return query
    select 'ok', c.id, max(b.created_at)
      from chores c
      join bumps b on b.chore_id = c.id and b.target_member_id = p_member_id
     where c.current_member_id = p_member_id
       and b.created_at >= c.updated_at
       and b.created_at > now() - interval '6 hours'
     group by c.id;
end;
$$;

revoke all on function get_nudges(text, uuid) from public;
grant execute on function get_nudges(text, uuid) to anon, authenticated;
