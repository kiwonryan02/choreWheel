-- Milestone 6: generalize `activity` so one feed can hold chores and todos.
--
--   before: activity(id, chore_id, member_id, completed_at, notified_at)
--   after:  activity(id, kind, member_id, chore_id null, todo_id null, created_at, notified_at)
--
-- Existing rows are backfilled as kind = 'chore' and keep their timestamps (the
-- column is renamed, not recreated). The FK from todo_id to todos is added by
-- the migration that creates the todos table.
--
-- complete_chore is replaced in the SAME migration: it inserts into activity, so
-- the rename would otherwise break every completion.

alter table activity rename column completed_at to created_at;
alter index activity_completed_at_idx rename to activity_created_at_idx;

alter table activity add column kind text;
update activity set kind = 'chore';
alter table activity alter column kind set not null;
alter table activity add constraint activity_kind_check check (kind in ('chore', 'todo'));

alter table activity alter column chore_id drop not null;
alter table activity add column todo_id uuid;

-- Exactly one subject, matching the kind.
alter table activity add constraint activity_subject_check check (
     (kind = 'chore' and chore_id is not null and todo_id is null)
  or (kind = 'todo'  and todo_id  is not null and chore_id is null)
);

-- ---------------------------------------------------------------------------
-- complete_chore: unchanged except that its activity row now sets `kind` and
-- uses created_at.
-- ---------------------------------------------------------------------------

create or replace function complete_chore(
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

  insert into activity (kind, chore_id, member_id, created_at)
  values ('chore', p_chore_id, p_expected_member_id, v_since)
  returning id into v_activity;

  return query select 'done', v_next, v_since, v_activity;
end;
$$;

revoke all on function complete_chore(text, uuid, uuid) from public;
grant execute on function complete_chore(text, uuid, uuid) to anon, authenticated;
