-- Seed an additional platform super-admin: info@synapse-solutions.ai.
-- Idempotent (no-op if the account doesn't exist or is already an admin),
-- mirroring the bootstrap seed in 20260619200000 (spec 2026-06-19-org-admin §6.3).
insert into public.platform_admins (user_id)
select id from auth.users where lower(email) = 'info@synapse-solutions.ai'
on conflict (user_id) do nothing;
