-- Todo completion notifications.
--
-- Same once-only claim the chore and bump notifications use, done in the
-- database so it is tested and decided in one place: the notify Edge Function
-- (service_role only) calls claim_todo_notification when the app reports a
-- check-off.

-- ---------------------------------------------------------------------------
-- claim_todo_notification(todo_id): called ONLY by the notify Edge Function.
--
-- Claims the todo's newest unannounced feed entry (under 2 minutes old), so each
-- check-off is announced at most once however often this is called, and returns
-- who checked it off plus the task's text. Returns nothing if:
--   * there is no recent unclaimed check-off for that todo (already announced,
--     too old, unknown), or
--   * the todo was unchecked in the meantime (its feed entry is deleted on
--     uncheck, and the todo is no longer done), so there is nothing to announce.
-- A todo that is checked, unchecked and checked again produces a fresh entry
-- each time it is checked, and each is announced once.
-- ---------------------------------------------------------------------------

create or replace function claim_todo_notification(p_todo_id uuid)
returns table (todo_text text, completer_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member uuid;
begin
  update activity a
     set notified_at = now()
   where a.id = (
           select a2.id
             from activity a2
            where a2.kind = 'todo'
              and a2.todo_id = p_todo_id
              and a2.notified_at is null
              and a2.created_at >= now() - interval '2 minutes'
            order by a2.created_at desc, a2.id desc
            limit 1
         )
     and a.notified_at is null
  returning a.member_id into v_member;

  if not found then
    return;
  end if;

  return query
    select t.text, v_member
      from todos t
     where t.id = p_todo_id
       and t.done;
end;
$$;

revoke all on function claim_todo_notification(uuid) from public, anon, authenticated;
grant execute on function claim_todo_notification(uuid) to service_role;
