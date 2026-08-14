-- 20260812060142_agent_capabilities_and_cadence.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (Spec 2a · Unit B):
--   1) user_agents.capabilities — the per-agent grant set. Default '{}' so
--      EVERY existing agent stays exactly as read-only as it is today; this
--      feature is opt-in per agent, by construction rather than by vigilance.
--   2) org_ai_settings.agent_capability_ceiling — the admin clamp. Defaults
--      OPEN because the inner gate (1) is already closed; closing both would
--      ship the feature invisible and require an admin round-trip before any
--      user's first agent could act.
--   3) Cadences beyond daily. The sweep's (user_agent_id, fire_date, fire_hour)
--      idempotency key is deliberately UNCHANGED — only a day predicate is
--      added, so a redelivered tick stays a no-op exactly as before.
--   4) instructions 2000 -> 8000 chars (free-form system prompts).
--
-- ADDITIVE ONLY: no drop column, no data-modifying statement. Every new column
-- carries a default that leaves each existing row semantically identical.

alter table public.user_agents
  add column if not exists capabilities text[] not null default '{}'::text[];

alter table public.user_agents
  drop constraint if exists user_agents_capabilities_known;
alter table public.user_agents
  add constraint user_agents_capabilities_known
  check (capabilities <@ array['board.write','files.write',
                              'automation.create','time.log']::text[]);

alter table public.org_ai_settings
  add column if not exists agent_capability_ceiling text[] not null
    default array['board.write','files.write',
                  'automation.create','time.log']::text[];

alter table public.org_ai_settings
  drop constraint if exists org_ai_settings_ceiling_known;
alter table public.org_ai_settings
  add constraint org_ai_settings_ceiling_known
  check (agent_capability_ceiling <@ array['board.write','files.write',
                                           'automation.create','time.log']::text[]);

-- Cadence. 28 is the day-of-month ceiling on purpose: it is the largest day
-- present in every month, so no agent can silently skip February.
alter table public.user_agents
  add column if not exists run_on_weekday int
    check (run_on_weekday between 0 and 6),
  add column if not exists run_on_day_of_month int
    check (run_on_day_of_month between 1 and 28);

-- Verified against the live DEV catalog before writing these drops: the real
-- names ARE `user_agents_cadence_check` and `user_agents_instructions_check`
-- (pg_constraint on public.user_agents). A `drop constraint if exists` against
-- a name that does not exist silently no-ops and leaves the OLD, narrower
-- constraint in force — which is why they were read rather than assumed.
alter table public.user_agents drop constraint if exists user_agents_cadence_check;
alter table public.user_agents
  add constraint user_agents_cadence_check
  check (cadence in ('daily','weekdays','weekly','monthly'));

-- Both halves or neither, per cadence — a 'weekly' agent with no weekday would
-- never fire, which is worse than refusing the write.
alter table public.user_agents
  drop constraint if exists user_agents_cadence_fields;
alter table public.user_agents
  add constraint user_agents_cadence_fields check (
    (cadence in ('daily','weekdays')
       and run_on_weekday is null and run_on_day_of_month is null)
    or (cadence = 'weekly'
       and run_on_weekday is not null and run_on_day_of_month is null)
    or (cadence = 'monthly'
       and run_on_weekday is null and run_on_day_of_month is not null)
  );

alter table public.user_agents drop constraint if exists user_agents_instructions_check;
alter table public.user_agents
  add constraint user_agents_instructions_check
  check (length(instructions) between 1 and 8000);

comment on column public.user_agents.capabilities is
  'Per-agent capability grants. Effective permission is this set INTERSECT '
  'org_ai_settings.agent_capability_ceiling INTERSECT the owner''s RLS.';

-- `authenticated` holds NO table-level INSERT/UPDATE on user_agents (its ACL is
-- rdDxtm) — both are granted COLUMN BY COLUMN, and a column-scoped grant does
-- not extend to columns added later. Without these three grants the owner's own
-- editor save (createAgent/updateAgent run on the request-scoped client) would
-- fail outright with "permission denied for table user_agents" the moment it
-- named a new column. org_ai_settings needs no such grant: its authenticated
-- ACL is table-level (arwdDxtm), so the new ceiling column is covered already.
grant insert (capabilities, run_on_weekday, run_on_day_of_month),
      update (capabilities, run_on_weekday, run_on_day_of_month)
  on public.user_agents to authenticated;

-- The hourly sweep, re-declared. This is the LIVE cron function that fires every
-- user's briefing: the body below is 20260801094820_personal_agent_sweep.sql
-- verbatim, with exactly ONE change — the `case cadence ... end` predicate added
-- to the agent select's where clause. Nothing else differs, deliberately.
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
          and case cadence
                when 'daily'    then true
                -- extract(dow) is 0=Sunday..6=Saturday, matching run_on_weekday.
                when 'weekdays' then extract(dow from v_local)::int between 1 and 5
                when 'weekly'   then extract(dow from v_local)::int = run_on_weekday
                when 'monthly'  then extract(day from v_local)::int = run_on_day_of_month
                else false
              end
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

-- `create or replace` on a security-definer function does NOT restore revoked
-- grants, so the revoke is re-asserted rather than assumed.
revoke execute on function public._personal_agent_sweep(timestamptz)
  from public, anon, authenticated;
