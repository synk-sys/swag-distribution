-- Supabase-specific: auth linkage, the single RLS policy, and Realtime.

-- Staff rows belong to Supabase Auth users; deleting the auth user removes access.
alter table staff drop constraint if exists staff_user_fk;
alter table staff add constraint staff_user_fk foreign key (user_id) references auth.users (id) on delete cascade;

-- "Is the signed-in user staff?" Runs as the table owner (security definer) because
-- browser roles have no access to the staff table itself. Returns only a boolean.
create or replace function is_staff() returns boolean
  language sql stable security definer set search_path = public, pg_temp
  as $$ select exists (select 1 from staff where user_id = auth.uid()) $$;
revoke all on function is_staff() from public;
grant execute on function is_staff() to authenticated;

-- Browsers may read ONLY the change counter, and only if they are staff.
-- Everything else (attendees, claims, audit, inventory) has no policy = no access.
drop policy if exists "staff can read live counter" on live_meta;
create policy "staff can read live counter" on live_meta
  for select to authenticated
  using (is_staff());

-- Push live_meta changes to subscribed browsers for real-time refresh.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'live_meta'
  ) then
    alter publication supabase_realtime add table live_meta;
  end if;
end $$;

-- Lock down the API roles completely for data tables (belt and braces with RLS).
revoke all on registrations, inventory, settings, events, idempotency, staff from anon, authenticated;
revoke all on live_meta from anon, authenticated;
grant select on live_meta to authenticated;
