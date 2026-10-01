-- Dev helper, NOT a migration. Run by hand in the Supabase SQL editor to put
-- the household back to its seeded state after testing:
-- both wheels on Kiwon, activity history and bumps cleared.

truncate activity, bumps;

update chores
   set current_member_id = (select id from members where name = 'Kiwon'),
       updated_at = now();
