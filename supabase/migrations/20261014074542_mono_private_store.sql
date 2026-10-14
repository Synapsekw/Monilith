-- 20261014074542_mono_private_store.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Add private encrypted Mono state with atomic versioned writes and bounded cleanup.

-- Opaque website-assistant state, separate from tenant/workspace data. Both the
-- origin namespace and record key are HMACs; ciphertext includes no plaintext PII.
create table public.mono_private_records (
  namespace text not null check (namespace ~ '^[0-9a-f]{64}$'),
  record_key text not null check (record_key ~ '^[0-9a-f]{64}$'),
  ciphertext text not null check (octet_length(ciphertext) between 40 and 524288),
  version uuid not null default gen_random_uuid(),
  expires_at bigint not null check (expires_at > 0),
  primary key (namespace, record_key)
);
create index mono_private_records_expiry_idx on public.mono_private_records (expires_at);
alter table public.mono_private_records enable row level security;
-- No browser policies: even an accidentally reintroduced grant cannot expose rows.
revoke all on table public.mono_private_records from public, anon, authenticated;
grant select, insert, update, delete on table public.mono_private_records to service_role;

create function public.mono_record_read(p_namespace text, p_key text)
returns table (ciphertext text, version uuid, expires_at bigint)
language sql stable security invoker set search_path = '' as $$
  select r.ciphertext, r.version, r.expires_at
  from public.mono_private_records r
  where r.namespace = p_namespace and r.record_key = p_key
    and r.expires_at > floor(extract(epoch from statement_timestamp()) * 1000)::bigint
  limit 1;
$$;

create function public.mono_record_compare_swap(
  p_namespace text, p_key text, p_ciphertext text, p_expires_at bigint,
  p_expected_version uuid default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_now bigint := floor(extract(epoch from statement_timestamp()) * 1000)::bigint;
  v_version uuid;
begin
  if p_expires_at is null or p_expires_at <= v_now or p_expires_at > v_now + 259200000 then
    raise exception 'Invalid Mono record expiry' using errcode = '22023';
  end if;
  -- A missing expected version means create-only (or replace an expired row).
  -- A supplied version must match a live row. This single statement serializes
  -- competing instances; there is no read-then-unconditional-write race.
  if p_expected_version is null then
    insert into public.mono_private_records as r (namespace, record_key, ciphertext, expires_at)
    values (p_namespace, p_key, p_ciphertext, p_expires_at)
    on conflict (namespace, record_key) do update
      set ciphertext = excluded.ciphertext, expires_at = excluded.expires_at, version = gen_random_uuid()
      where r.expires_at <= v_now
    returning version into v_version;
  else
    update public.mono_private_records r
      set ciphertext = p_ciphertext, expires_at = p_expires_at, version = gen_random_uuid()
      where r.namespace = p_namespace and r.record_key = p_key
        and r.version = p_expected_version and r.expires_at > v_now
    returning r.version into v_version;
  end if;
  return v_version;
end;
$$;

create function public.mono_records_cleanup(p_limit integer default 100)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_count integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 250 then
    raise exception 'Invalid Mono cleanup limit' using errcode = '22023';
  end if;
  with expired as (
    select r.namespace, r.record_key from public.mono_private_records r
    where r.expires_at <= floor(extract(epoch from statement_timestamp()) * 1000)::bigint
    order by r.expires_at limit p_limit for update skip locked
  )
  delete from public.mono_private_records r using expired e
    where r.namespace = e.namespace and r.record_key = e.record_key;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mono_record_read(text, text) from public, anon, authenticated;
revoke all on function public.mono_record_compare_swap(text, text, text, bigint, uuid) from public, anon, authenticated;
revoke all on function public.mono_records_cleanup(integer) from public, anon, authenticated;
grant execute on function public.mono_record_read(text, text) to service_role;
grant execute on function public.mono_record_compare_swap(text, text, text, bigint, uuid) to service_role;
grant execute on function public.mono_records_cleanup(integer) to service_role;

-- The existing pg_cron extension runs this independently of website traffic.
-- At most 100 expired rows per minute, using the expiry index; no tenant data.
select cron.schedule('mono-private-records-expiry', '* * * * *',
  $cron$ select public.mono_records_cleanup(100) $cron$);
