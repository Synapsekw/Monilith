-- Personal Monos, Plan 2A / unit I. A Mono is an org member with its own
-- role value, so is_org_member/is_member_of keep working for its reads while
-- every admin path (has_org_role(['owner','admin']) and the app's
-- owner/admin checks) stays closed to it.
--
-- A file of its own: Postgres refuses to USE an enum value in the
-- transaction that added it, and apply_migration runs one file per
-- transaction. Additive and inert until the next migration uses it.
alter type public.org_role add value if not exists 'agent';
