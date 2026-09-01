-- ==================================================================
-- Audit trail migration — run once in Supabase SQL Editor
-- ==================================================================
-- Adds two columns to `matches` so every approved score records WHO
-- approved it and WHEN. The admin panel (js/admin.js -> approveMatch)
-- already writes to these columns after a successful approval — this
-- migration just needs to run once so those columns exist.
--
-- Safe to run more than once (uses IF NOT EXISTS).

alter table matches
  add column if not exists approved_by uuid references auth.users(id);

alter table matches
  add column if not exists approved_at timestamptz;

-- Nothing else to do — no RLS changes needed, since admins already
-- have full read/write on `matches` per the existing policies.
