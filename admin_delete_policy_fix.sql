-- ==================================================================
-- Admin DELETE policy fix — run once in Supabase SQL Editor
-- ==================================================================
-- If your original schema.sql only wrote UPDATE/SELECT policies for
-- signed-in admins (and not DELETE), Supabase's Row Level Security
-- silently blocks every delete: no error is thrown, the row just
-- isn't removed. That's almost certainly why the "Delete" buttons in
-- admin.html looked broken.
--
-- Safe to run more than once.

drop policy if exists "admins can delete teams" on teams;
create policy "admins can delete teams"
  on teams for delete
  to authenticated
  using (true);

drop policy if exists "admins can delete matches" on matches;
create policy "admins can delete matches"
  on matches for delete
  to authenticated
  using (true);
