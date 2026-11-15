-- 20261115173702_pending_invitations_folder_context.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   my_pending_invitations() also returns who sent the invitation and, when
--   the org invitation carries pending folder invitations, the first folder
--   (id and name) plus how many folders there are. The bell row, the guest
--   empty state and the waiting screen use it to say
--   "<inviter> invited you to the folder <name> in <org>" and to send the
--   person to that folder after they accept.
--
--   The return type grows, so the function is dropped and recreated (create
--   or replace cannot change OUT columns). The five existing columns keep
--   their names, types and order, so the deployed code that reads only those
--   keeps working. The read is still limited to invitations addressed to the
--   caller's own email, and is now bounded (50 newest).
--
--   The folder subquery matches what accept_invitation / redeem_invitations
--   redeem: every pending folder invitation for this email in the same org.

drop function if exists public.my_pending_invitations();

create function public.my_pending_invitations()
returns table (
  id uuid,
  org_id uuid,
  org_name text,
  role public.org_role,
  created_at timestamptz,
  inviter_name text,
  folder_id uuid,
  folder_name text,
  folder_count integer
)
language sql stable security definer set search_path = '' as $$
  with me as (
    select lower(u.email::text) as email
      from auth.users u
     where u.id = (select auth.uid())
  )
  select i.id,
         i.org_id,
         o.name,
         i.role,
         i.created_at,
         coalesce(nullif(btrim(p.full_name), ''), p.email),
         f.folder_id,
         f.folder_name,
         coalesce(f.folder_count, 0)
    from me
    join public.org_invitations i on lower(i.email) = me.email
    join public.organizations o on o.id = i.org_id
    left join public.profiles p on p.id = i.invited_by
    left join lateral (
      select (array_agg(fo.id order by fi.created_at, fi.id))[1] as folder_id,
             (array_agg(fo.name order by fi.created_at, fi.id))[1] as folder_name,
             count(*)::integer as folder_count
        from public.folder_invitations fi
        join public.folders fo on fo.id = fi.folder_id
       where fi.org_id = i.org_id
         and lower(fi.email) = me.email
         and fi.status = 'pending'
    ) f on true
   where i.status = 'pending'
   order by i.created_at desc
   limit 50;
$$;

-- A new function grants EXECUTE to PUBLIC by default: close that.
revoke execute on function public.my_pending_invitations() from public, anon;
grant execute on function public.my_pending_invitations() to authenticated;
