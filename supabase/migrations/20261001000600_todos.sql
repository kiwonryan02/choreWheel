-- Milestone 7: shared todo list.
--
-- Any roommate can add, check off, and uncheck any todo; only the creator can
-- delete one, and only while it is open. All writes go through passcode-checked
-- RPCs (the public key can only read). Checking a todo writes ONE feed entry in
-- the same transaction; unchecking deletes it. Creating a todo is not logged.
--
-- Todo check-offs are announced by push; that is the next migration (todo_notifications).

create table todos (
  id            uuid primary key default gen_random_uuid(),
  text          text not null,
  created_by    uuid not null references members (id),
  created_at    timestamptz not null default now(),
  done          boolean not null default false,
  completed_by  uuid references members (id),
  completed_at  timestamptz,
  constraint todos_text_check check (btrim(text) <> '' and char_length(text) <= 200),
  constraint todos_done_check check (
       (done and completed_by is not null and completed_at is not null)
    or (not done and completed_by is null and completed_at is null)
  )
);
create index todos_open_idx on todos (created_at) where not done;
create index todos_done_idx on todos (completed_at desc) where done;

alter table todos enable row level security;
create policy "anon can read todos" on todos for select to anon, authenticated using (true);
grant select on todos to anon, authenticated;
-- Defense in depth: never writable through the API, whatever a project's default grants are.
revoke insert, update, delete, truncate on todos from anon, authenticated;

-- Phones subscribe to todos for instant updates.
alter publication supabase_realtime add table todos;

-- Feed entries for todos. Deleting a todo removes its entries.
alter table activity
  add constraint activity_todo_id_fkey foreign key (todo_id) references todos (id) on delete cascade;
create index activity_todo_id_idx on activity (todo_id) where todo_id is not null;

-- ---------------------------------------------------------------------------
-- create_todo(passcode, text, member_id)
--   -> 'ok' | 'empty' | 'too_long' | 'unknown_member' | 'invalid' | 'locked' | 'not_set'
-- Text is trimmed first, so whitespace-only text is 'empty' and the 200
-- character limit applies to what is actually stored.
-- ---------------------------------------------------------------------------

create or replace function create_todo(p_passcode text, p_text text, p_member_id uuid)
returns table (status text, todo_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth text;
  v_text text := regexp_replace(coalesce(p_text, ''), '^\s+|\s+$', '', 'g');
  v_id   uuid;
begin
  v_auth := check_passcode(p_passcode);
  if v_auth <> 'ok' then
    return query select v_auth, null::uuid;
    return;
  end if;

  if v_text = '' then
    return query select 'empty', null::uuid;
    return;
  end if;
  if char_length(v_text) > 200 then
    return query select 'too_long', null::uuid;
    return;
  end if;
  if not exists (select 1 from members m where m.id = p_member_id) then
    return query select 'unknown_member', null::uuid;
    return;
  end if;

  insert into todos (text, created_by) values (v_text, p_member_id)
  returning id into v_id;

  return query select 'ok', v_id;
end;
$$;

revoke all on function create_todo(text, text, uuid) from public;
grant execute on function create_todo(text, text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- set_todo_done(passcode, todo_id, member_id, done)
--   -> 'ok' | 'unchanged' | 'not_found' | 'unknown_member' | 'bad_request'
--      | 'invalid' | 'locked' | 'not_set'
--
-- Idempotent: if the todo is already in the requested state nothing happens and
-- no second feed entry is written. The row lock makes two simultaneous check-offs
-- take turns, so the second sees it already done and reports 'unchanged':
-- exactly one feed entry, naming whoever got there first.
-- ---------------------------------------------------------------------------

create or replace function set_todo_done(
  p_passcode   text,
  p_todo_id    uuid,
  p_member_id  uuid,
  p_done       boolean
)
returns table (status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth text;
  v_todo todos%rowtype;
  v_now  timestamptz;
begin
  v_auth := check_passcode(p_passcode);
  if v_auth <> 'ok' then
    return query select v_auth;
    return;
  end if;

  if p_done is null then
    return query select 'bad_request';
    return;
  end if;
  if not exists (select 1 from members m where m.id = p_member_id) then
    return query select 'unknown_member';
    return;
  end if;

  select * into v_todo from todos t where t.id = p_todo_id for update;
  if not found then
    return query select 'not_found';
    return;
  end if;

  if v_todo.done = p_done then
    return query select 'unchanged';
    return;
  end if;

  if p_done then
    v_now := now();
    update todos t
       set done = true, completed_by = p_member_id, completed_at = v_now
     where t.id = p_todo_id;
    insert into activity (kind, todo_id, member_id, created_at)
    values ('todo', p_todo_id, p_member_id, v_now);
  else
    update todos t
       set done = false, completed_by = null, completed_at = null
     where t.id = p_todo_id;
    delete from activity a where a.kind = 'todo' and a.todo_id = p_todo_id;
  end if;

  return query select 'ok';
end;
$$;

revoke all on function set_todo_done(text, uuid, uuid, boolean) from public;
grant execute on function set_todo_done(text, uuid, uuid, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- delete_todo(passcode, todo_id, member_id)
--   -> 'ok' | 'not_found' | 'not_creator' | 'already_done' | 'invalid' | 'locked' | 'not_set'
-- Only the creator, and only while the todo is still open.
-- ---------------------------------------------------------------------------

create or replace function delete_todo(p_passcode text, p_todo_id uuid, p_member_id uuid)
returns table (status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth text;
  v_todo todos%rowtype;
begin
  v_auth := check_passcode(p_passcode);
  if v_auth <> 'ok' then
    return query select v_auth;
    return;
  end if;

  select * into v_todo from todos t where t.id = p_todo_id for update;
  if not found then
    return query select 'not_found';
    return;
  end if;
  if v_todo.created_by is distinct from p_member_id then
    return query select 'not_creator';
    return;
  end if;
  if v_todo.done then
    return query select 'already_done';
    return;
  end if;

  delete from todos t where t.id = p_todo_id;
  return query select 'ok';
end;
$$;

revoke all on function delete_todo(text, uuid, uuid) from public;
grant execute on function delete_todo(text, uuid, uuid) to anon, authenticated;
