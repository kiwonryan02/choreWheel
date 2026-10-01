-- Milestone 2: explicit read grants + the atomic complete_chore RPC.

-- ---------------------------------------------------------------------------
-- Read grants
-- Supabase no longer auto-grants new public tables to anon/authenticated, so
-- the select policies from the init migration are not enough on their own.
-- bumps and push_subscriptions are intentionally left out.
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;
grant select on members, chores, chore_rotation, activity to anon, authenticated;

-- ---------------------------------------------------------------------------
-- complete_chore(chore_id, expected_member_id)
--
-- Advances the wheel to the next member in that chore's rotation, but only if
-- expected_member_id is still the person on top. The row lock makes two racing
-- callers take turns: the second one re-checks after the first commits, no
-- longer matches, and gets advanced = false instead of advancing a second time.
-- The activity row is written in the same transaction.
--
-- TODO(M3): add the household passcode check; until then anyone holding the
-- anon key can call this. The frontend is not deployed before M3.
-- ---------------------------------------------------------------------------

create or replace function complete_chore(p_chore_id uuid, p_expected_member_id uuid)
returns table (advanced boolean, up_now uuid, since timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pos   int;
  v_next  uuid;
  v_since timestamptz;
begin
  perform 1
    from chores
   where id = p_chore_id
     and current_member_id = p_expected_member_id
     for update;

  if not found then
    -- Someone else already completed it (or the id is wrong): report the
    -- current state so the caller can reconcile.
    return query
      select false, c.current_member_id, c.updated_at
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

  return query select true, v_next, v_since;
end;
$$;

revoke all on function complete_chore(uuid, uuid) from public;
grant execute on function complete_chore(uuid, uuid) to anon, authenticated;
