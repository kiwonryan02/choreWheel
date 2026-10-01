-- Household seed. Mirrors src/config/household.ts — keep the two in sync.

insert into members (name, color, position) values
  ('Kiwon',  '#2563eb', 1),
  ('Lucas',  '#047857', 2),
  ('Anish',  '#b45309', 3),
  ('Carter', '#be185d', 4);

-- Both wheels start on Kiwon.
insert into chores (slug, name, current_member_id)
select c.slug, c.name, m.id
from (values ('dishes', 'Dishes'), ('trash', 'Trash')) as c (slug, name)
cross join members m
where m.name = 'Kiwon';

-- Each wheel rotates in its own order.
insert into chore_rotation (chore_id, member_id, position)
select c.id, m.id, r.position
from (values
  ('dishes', 'Kiwon',  1),
  ('dishes', 'Lucas',  2),
  ('dishes', 'Anish',  3),
  ('dishes', 'Carter', 4),
  ('trash',  'Kiwon',  1),
  ('trash',  'Carter', 2),
  ('trash',  'Anish',  3),
  ('trash',  'Lucas',  4)
) as r (chore_slug, member_name, position)
join chores  c on c.slug = r.chore_slug
join members m on m.name = r.member_name;
