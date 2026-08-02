-- 20260801094820_personal_agent_sweep.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (Personal Agents · Phase 1 · Task 10):
--   1) user_agent_fires      — once-only fire ledger for the sweep, keyed
--                              (user_agent_id, fire_date, fire_hour). Mirrors
--                              board_agent_fires (20260720120517_board_agents.sql).
--   2) _personal_agent_sweep — pg_cron sweep (hourly) reusing the EXACT
--                              org-timezone + fire-ledger idempotency pattern
--                              from _autopilot_sweep → signed net.http_post to
--                              /api/ai/personal-agent. Per-org failures are
--                              isolated (bad timezone etc. => skip that org).
--   3) cron job 'personal-agent-sweep', schedule 5 * * * * — deliberately
--      staggered off 'autopilot-sweep' (0 * * * *) so the two ticks never
--      contend for the same minute.
--
-- Signing (identical to _autopilot_sweep / the A2 ai_step hop): the DB reads
-- the endpoint base URL from Vault `app_url` and the HMAC secret from Vault
-- `ai_pgnet_hmac_secret`; the server verifies with env AI_PGNET_HMAC_SECRET.
-- The signature is over `v_body::text` and pg_net transmits that same jsonb
-- serialization, so the route's verifyBody(rawBody) matches byte-for-byte.
--
-- Idempotency: the insert into user_agent_fires is `on conflict do nothing`,
-- and the http_post only fires when `get diagnostics ... row_count` shows
-- THIS tick won the insert — a redelivered tick (or a second cron worker
-- picking up the same slot) is a no-op instead of a second email.

-- pgcrypto (extensions.hmac) — idempotent guard, harmless if already present.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.user_agent_fires (
  user_agent_id uuid not null references public.user_agents (id) on delete cascade,
  org_id        uuid not null references public.organizations (id) on delete cascade,
  fire_date     date not null,
  fire_hour     int not null,
  fired_at      timestamptz not null default now(),
  primary key (user_agent_id, fire_date, fire_hour)
);

alter table public.user_agent_fires enable row level security;
-- No policies on purpose: definer/service-role access only, same as
-- board_agent_fires — this ledger is never read/written by a client session.

create or replace function public._personal_agent_sweep(
  p_now timestamptz default now()
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_org     record;
  v_agent   record;
  v_local   timestamp;
  v_hour    int;
  v_today   date;
  v_count   int;
  v_app_url text;
  v_secret  text;
  v_body    jsonb;
  v_sig     text;
begin
  select decrypted_secret into v_app_url
    from vault.decrypted_secrets where name = 'app_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'ai_pgnet_hmac_secret';
  -- Not provisioned (Vault secrets missing) — nothing to fire this tick.
  if v_app_url is null or v_secret is null then
    return;
  end if;

  for v_org in select id, timezone from public.organizations loop
    begin
      v_local := p_now at time zone v_org.timezone;   -- DST-correct wall clock
      v_hour  := extract(hour from v_local)::int;
      v_today := v_local::date;

      for v_agent in
        select id, org_id, run_at_local_hour
        from public.user_agents
        where org_id = v_org.id
          and enabled
          and run_at_local_hour = v_hour
      loop
        insert into public.user_agent_fires
          (user_agent_id, org_id, fire_date, fire_hour)
        values (v_agent.id, v_agent.org_id, v_today, v_hour)
        on conflict do nothing;

        -- Only fire when WE won the ledger insert — this is what makes a
        -- redelivered tick a no-op instead of a second email.
        get diagnostics v_count = row_count;
        if v_count > 0 then
          v_body := jsonb_build_object(
            'agent_id',  v_agent.id,
            'fire_date', v_today::text,
            'fire_hour', v_hour
          );
          v_sig := encode(
            extensions.hmac(v_body::text, v_secret, 'sha256'), 'hex');
          perform net.http_post(
            url := v_app_url || '/api/ai/personal-agent',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'X-Pulse-Signature', v_sig),
            body := v_body
          );
        end if;
      end loop;
    exception when others then
      raise warning 'personal agent sweep skipped org %: %', v_org.id, sqlerrm;
    end;
  end loop;
end; $$;

revoke execute on function public._personal_agent_sweep(timestamptz)
  from public, anon, authenticated;

-- Hourly, staggered 5 minutes off autopilot-sweep so the two ticks don't
-- contend. cron.schedule upserts by job name => this migration stays
-- re-runnable.
select cron.schedule(
  'personal-agent-sweep',
  '5 * * * *',
  $cron$ select public._personal_agent_sweep() $cron$
);
