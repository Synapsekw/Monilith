-- Item creation metadata: attribute the creator and freeze creator + timestamp.
-- created_at already exists on public.items (boards_core). We add created_by,
-- backfill it to each row's organization creator, then install triggers that
-- (a) stamp creator + created_at from the authenticated caller on INSERT, and
-- (b) make both fields immutable on UPDATE.

-- 1. Column: who created the row (mirrors organizations.created_by convention).
alter table public.items
  add column created_by uuid references auth.users (id);

-- 2. Backfill existing rows to their org's creator (the one sanctioned default).
update public.items i
set created_by = o.created_by
from public.organizations o
where o.id = i.org_id
  and i.created_by is null;

-- 3. Lock the column down now that every row has a value.
alter table public.items
  alter column created_by set not null;

-- 4. Attribution on INSERT. Force creator + timestamp from the authenticated
--    caller, ignoring any client-supplied value (anti-spoofing). When there is
--    no JWT (service-role / migration contexts), keep the provided value so
--    tooling and seeds still work.
create function public.items_set_creation_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
    new.created_at := now();
  end if;
  return new;
end;
$$;

create trigger items_set_creation_metadata
  before insert on public.items
  for each row execute function public.items_set_creation_metadata();

-- 5. Immutability on UPDATE. created_by/created_at can never change, for any
--    caller. (Installed AFTER the backfill so the one-time update above runs.)
create function public.items_protect_creation_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end;
$$;

create trigger items_protect_creation_metadata
  before update on public.items
  for each row execute function public.items_protect_creation_metadata();
