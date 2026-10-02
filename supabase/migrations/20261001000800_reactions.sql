-- Reactions on activity feed entries: 👍 ❤️ 🐐 🙏 (thumbs_up, heart, goat, thanks).
--
-- Anyone can react to any entry with any of the four, and take it back. One row
-- per (entry, person, kind), so a person can use several different reactions on
-- one entry but each only once. Reactions are visible to everyone (the app shows
-- counts, and who reacted); they are NOT anonymous like bumps.
--
-- Deleting a feed entry (unchecking a todo deletes its entry) deletes its reactions.

create table reactions (
  activity_id  uuid not null references activity (id) on delete cascade,
  member_id    uuid not null references members (id),
  kind         text not null,
  created_at   timestamptz not null default now(),
  primary key (activity_id, member_id, kind),
  constraint reactions_kind_check check (kind in ('thumbs_up', 'heart', 'goat', 'thanks'))
);

alter table reactions enable row level security;
create policy "anon can read reactions" on reactions for select to anon, authenticated using (true);
grant select on reactions to anon, authenticated;
-- Never writable through the API, whatever a project's default grants are.
revoke insert, update, delete, truncate on reactions from anon, authenticated;

-- Phones subscribe to reactions so they appear instantly.
alter publication supabase_realtime add table reactions;

-- ---------------------------------------------------------------------------
-- set_reaction(passcode, activity_id, member_id, kind, on)
--   -> 'ok' | 'unchanged' | 'not_found' | 'unknown_member' | 'bad_kind' | 'bad_request'
--      | 'invalid' | 'locked' | 'not_set'
--
-- Idempotent: asking for the state it is already in changes nothing ('unchanged'),
-- so two quick taps or two phones can't flip it back and forth.
-- ---------------------------------------------------------------------------

create or replace function set_reaction(
  p_passcode     text,
  p_activity_id  uuid,
  p_member_id    uuid,
  p_kind         text,
  p_on           boolean
)
returns table (status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth text;
  v_rows int;
begin
  v_auth := check_passcode(p_passcode);
  if v_auth <> 'ok' then
    return query select v_auth;
    return;
  end if;

  if p_on is null then
    return query select 'bad_request';
    return;
  end if;
  if p_kind is null or p_kind not in ('thumbs_up', 'heart', 'goat', 'thanks') then
    return query select 'bad_kind';
    return;
  end if;
  if not exists (select 1 from members m where m.id = p_member_id) then
    return query select 'unknown_member';
    return;
  end if;

  -- Hold the entry so it can't be deleted (a todo unchecked) between this check
  -- and the insert.
  perform 1 from activity a where a.id = p_activity_id for key share;
  if not found then
    return query select 'not_found';
    return;
  end if;

  if p_on then
    insert into reactions (activity_id, member_id, kind)
    values (p_activity_id, p_member_id, p_kind)
    on conflict do nothing;
  else
    delete from reactions r
     where r.activity_id = p_activity_id and r.member_id = p_member_id and r.kind = p_kind;
  end if;
  get diagnostics v_rows = row_count;

  return query select case when v_rows > 0 then 'ok' else 'unchanged' end;
end;
$$;

revoke all on function set_reaction(text, uuid, uuid, text, boolean) from public;
grant execute on function set_reaction(text, uuid, uuid, text, boolean) to anon, authenticated;
