-- Weekly health digest infrastructure (MVP Final item 8).
-- pg_cron pings the app route daily; the route is idempotent per (org, week) via
-- digest_runs, so a failed Monday send retries automatically all week.

alter table public.profiles
  add column if not exists email_digest_opt_out boolean not null default false;

comment on column public.profiles.email_digest_opt_out is
  'Opt-out for the weekly health digest EMAIL only; in-app digest notifications are unaffected.';

create table if not exists public.digest_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'skipped', 'failed')),
  stats jsonb,
  email_sent_count integer,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (org_id, period_start)
);

-- Service-role only: RLS on, no policies (default deny for authenticated).
alter table public.digest_runs enable row level security;
create index if not exists digest_runs_org_id_idx on public.digest_runs (org_id);

-- Per-org digest payload: per-board counts + bounded name samples for the email.
-- Boards where overdue = incomplete = new = 0 are dropped. Bounded: 200 boards,
-- 5 sample names per list. Internal (service-role caller; no authenticated grant).
create or replace function public._org_health_digest(
  p_org_id uuid,
  p_since timestamptz
) returns table (
  board_id uuid,
  board_name text,
  total_items integer,
  done_items integer,
  overdue_items integer,
  incomplete_items integer,
  new_items integer,
  new_sample jsonb,
  incomplete_sample jsonb
)
language plpgsql stable security definer set search_path = '' as $$
declare
  b record;
  c record;
begin
  for b in
    select bd.id, bd.name
    from public.boards bd
    where bd.org_id = p_org_id
    order by bd.created_at asc
    limit 200
  loop
    select * into c from public._board_health_counts(b.id, p_since);
    if c.total_items = 0
       or (c.overdue_items = 0 and c.incomplete_items = 0 and c.new_items = 0) then
      continue;
    end if;
    board_id := b.id;
    board_name := b.name;
    total_items := c.total_items;
    done_items := c.done_items;
    overdue_items := c.overdue_items;
    incomplete_items := c.incomplete_items;
    new_items := c.new_items;
    new_sample := (
      select coalesce(jsonb_agg(x.item_name), '[]'::jsonb)
      from (
        select f.item_name, f.item_created_at
        from public._board_health_flags(b.id) f
        where f.item_created_at >= p_since
        order by f.item_created_at desc
        limit 5
      ) x
    );
    incomplete_sample := (
      select coalesce(jsonb_agg(x.item_name), '[]'::jsonb)
      from (
        select f.item_name, f.item_created_at
        from public._board_health_flags(b.id) f
        where f.is_incomplete
        order by f.item_created_at desc
        limit 5
      ) x
    );
    return next;
  end loop;
end; $$;

revoke execute on function public._org_health_digest(uuid, timestamptz)
  from public, anon, authenticated;

-- Cron target: read app_url + digest_secret from Vault, POST the ping.
-- Fire-and-forget: the app route is the reliability boundary (idempotent claim +
-- daily retry); no pg_net response reconcile needed.
create or replace function public._health_digest_ping()
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'app_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'digest_secret';
  if v_url is null or v_secret is null then
    raise notice 'health digest: vault secrets app_url/digest_secret missing; skipping';
    return;
  end if;
  perform net.http_post(
    url := v_url || '/api/digest/run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret),
    body := '{}'::jsonb
  );
end; $$;

revoke execute on function public._health_digest_ping()
  from public, anon, authenticated;

-- Daily at 07:00 UTC; job name is the upsert key (re-runnable migration).
select cron.schedule(
  'health-digest-ping',
  '0 7 * * *',
  $cron$ select public._health_digest_ping() $cron$
);
