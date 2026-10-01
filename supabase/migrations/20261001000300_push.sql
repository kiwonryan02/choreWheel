-- Milestone 4: Web Push support.
--
-- * activity.notified_at: the notify Edge Function claims a completion by
--   setting this (only if it is still null), so each completion produces at
--   most one round of notifications no matter how often it is called.
-- * save_push_subscription: passcode-checked upsert of a device's subscription.
-- * complete_chore now also returns the new activity row's id, which the app
--   hands to the notify function.

alter table activity add column notified_at timestamptz;

-- The Edge Function runs as service_role. Newer Supabase projects don't
-- auto-grant new tables to any API role, so spell out exactly what it needs.
grant select, delete on push_subscriptions to service_role;
grant select, update on activity to service_role;
grant select on members, chores to service_role;

-- ---------------------------------------------------------------------------
-- save_push_subscription -> 'ok' | 'invalid' | 'locked' | 'not_set'
--                           | 'unknown_member' | 'bad_subscription'
-- A device re-files its subscription under whoever is using it, so switching
-- person on a phone moves its notifications to the right roommate.
-- ---------------------------------------------------------------------------

create or replace function save_push_subscription(
  p_passcode   text,
  p_member_id  uuid,
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth text;
begin
  v_auth := check_passcode(p_passcode);
  if v_auth <> 'ok' then
    return v_auth;
  end if;

  if not exists (select 1 from members where id = p_member_id) then
    return 'unknown_member';
  end if;

  if p_endpoint is null or p_endpoint !~ '^https://'
     or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    return 'bad_subscription';
  end if;

  insert into push_subscriptions (member_id, endpoint, p256dh, auth)
  values (p_member_id, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set member_id = excluded.member_id,
        p256dh    = excluded.p256dh,
        auth      = excluded.auth;

  return 'ok';
end;
$$;

revoke all on function save_push_subscription(text, uuid, text, text, text) from public;
grant execute on function save_push_subscription(text, uuid, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- complete_chore: identical to the M3 version except that it also returns the
-- id of the activity row it wrote ('done' only; null otherwise). A function's
-- result columns can't change in place, so it is dropped and recreated.
-- ---------------------------------------------------------------------------

drop function complete_chore(text, uuid, uuid);

create function complete_chore(
  p_passcode             text,
  p_chore_id             uuid,
  p_expected_member_id   uuid
)
returns table (status text, up_now uuid, since timestamptz, activity_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth     text;
  v_pos      int;
  v_next     uuid;
  v_since    timestamptz;
  v_activity uuid;
begin
  v_auth := check_passcode(p_passcode);
  if v_auth <> 'ok' then
    return query select v_auth, null::uuid, null::timestamptz, null::uuid;
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
      select 'stale', c.current_member_id, c.updated_at, null::uuid
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
  values (p_chore_id, p_expected_member_id, v_since)
  returning id into v_activity;

  return query select 'done', v_next, v_since, v_activity;
end;
$$;

revoke all on function complete_chore(text, uuid, uuid) from public;
grant execute on function complete_chore(text, uuid, uuid) to anon, authenticated;
