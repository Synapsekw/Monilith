-- 20260720120517_board_agents.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (Phase 10 · E5 · Task A3 — F14 "Autopilot agent"):
--   Adds a per-board SCHEDULED agent that, on a cadence, reads its board and takes
--   a small, reversible housekeeping action set — reusing F13's async-hop +
--   confined-apply substrate (A1/A2) and the existing date-sweep schedule pattern.
--
--   1) board_agents            — one agent config per board (enabled kill switch,
--                                cadence, local hour, which housekeeping tasks).
--   2) board_agent_runs        — audit (mirrors automation_runs) + idempotency
--                                (unique per agent per fire slot date+hour).
--   3) board_agent_fires       — once-only fire ledger for the sweep (mirrors
--                                automation_date_fires), keyed date+hour.
--   4) Platform bot identity    — ONE auth.users row ("Pulse Autopilot", no login)
--                                + a profiles row flagged is_agent, exposed via a
--                                STABLE helper platform_agent_user_id(). This is the
--                                truthful author of agent-written comments /
--                                notifications (satisfies the frozen-author trigger).
--   5) board_agent_apply(...)   — SECURITY DEFINER confined applier: the ONLY write
--                                path. Re-applies the per-action guards (move_to_group
--                                / set_percent / notify ONLY — never set_option or
--                                call_webhook), authors as the bot, returns an outcome.
--   6) _autopilot_sweep(...)    — pg_cron sweep (hourly) reusing the EXACT
--                                _automation_date_sweep org-timezone + fire-ledger
--                                idempotency pattern → signed net.http_post to
--                                /api/ai/autopilot.
--
-- Signing (shared E5 decision, identical to the A2 ai_step hop): the DB reads the
-- endpoint base URL from Vault `app_url` and the HMAC secret from Vault
-- `ai_pgnet_hmac_secret`; the server verifies with env AI_PGNET_HMAC_SECRET. The
-- signature is over `v_body::text` and pg_net transmits that same jsonb
-- serialization, so the route's verifyBody(rawBody) matches byte-for-byte.

-- pgcrypto (extensions.hmac) — idempotent guard, harmless if already present.
create extension if not exists pgcrypto with schema extensions;

-- ── 0) Platform bot identity ─────────────────────────────────────────────────
-- profiles gains an `is_agent` flag so the UI can badge bot-authored content.
alter table public.profiles
  add column if not exists is_agent boolean not null default false;

-- ONE dedicated auth.users row — a principal to author comments/notifications as
-- (spec §4.3). No password, cannot log in (no session, no client key ever issued).
-- Fixed id + fixed email so on-conflict is a true idempotent no-op on re-apply.
-- Only id / is_sso_user / is_anonymous are NOT NULL on auth.users; the empty-string
-- token columns are set to '' defensively (GoTrue does '='-scans on some).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-00000000b071',
  'authenticated', 'authenticated',
  'pulse-autopilot@pulse.internal', null,
  now(), now(), now(),
  '{"provider":"platform","providers":["platform"]}'::jsonb,
  '{"full_name":"Pulse Autopilot"}'::jsonb, false,
  '', '', '', '',
  false, false
)
on conflict (id) do nothing;

-- The handle_new_user trigger mirrors the row into public.profiles; upsert here is
-- belt-and-braces (and stamps is_agent) so a re-apply / missing trigger still lands
-- a correct, flagged profile.
insert into public.profiles (id, email, full_name, is_agent)
values (
  '00000000-0000-4000-8000-00000000b071',
  'pulse-autopilot@pulse.internal', 'Pulse Autopilot', true
)
on conflict (id) do update
  set is_agent = true, full_name = 'Pulse Autopilot';

-- STABLE helper: the platform bot's user id (resolved by its fixed email so it is
-- id-independent). SECURITY DEFINER to read auth.users under search_path=''.
create or replace function public.platform_agent_user_id()
returns uuid
language sql stable security definer set search_path = '' as $$
  select id from auth.users where email = 'pulse-autopilot@pulse.internal' limit 1;
$$;
revoke execute on function public.platform_agent_user_id() from public, anon;
grant execute on function public.platform_agent_user_id() to authenticated, service_role;

-- ── 1) board_agents ──────────────────────────────────────────────────────────
create table public.board_agents (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations (id) on delete cascade,
  board_id          uuid not null references public.boards (id) on delete cascade,
  enabled           boolean not null default true,
  cadence           text not null default 'daily' check (cadence in ('daily','hourly')),
  run_at_local_hour int  not null default 8 check (run_at_local_hour between 0 and 23),
  config            jsonb not null default '{}'::jsonb,  -- { tasks: [...] }
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (board_id)  -- at most one agent per board (the card upserts on board_id)
);
create index board_agents_org_idx on public.board_agents (org_id);
-- Partial index for the sweep's "enabled agents" scan.
create index board_agents_enabled_idx on public.board_agents (org_id) where enabled;

create trigger board_agents_set_updated_at
  before update on public.board_agents
  for each row execute function public.set_updated_at();

alter table public.board_agents enable row level security;
-- Read: any org member. Write: org owner/admin only (spec §4.3 — a human enables).
create policy board_agents_select on public.board_agents
  for select to authenticated using (public.is_org_member(org_id));
create policy board_agents_insert on public.board_agents
  for insert to authenticated with check (
    public.has_org_role(org_id, array['owner','admin']::public.org_role[])
    and created_by = (select auth.uid())
  );
create policy board_agents_update on public.board_agents
  for update to authenticated
  using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
create policy board_agents_delete on public.board_agents
  for delete to authenticated
  using (public.has_org_role(org_id, array['owner','admin']::public.org_role[]));
grant select, insert, update, delete on public.board_agents to authenticated;

-- ── 2) board_agent_runs (audit + idempotency) ────────────────────────────────
create table public.board_agent_runs (
  id             uuid primary key default gen_random_uuid(),
  board_agent_id uuid not null references public.board_agents (id) on delete cascade,
  org_id         uuid not null references public.organizations (id) on delete cascade,
  board_id       uuid not null references public.boards (id) on delete cascade,
  fire_date      date not null,
  fire_hour      smallint not null default 0,
  status         text not null check (status in ('ran','skipped','error')),
  actions        jsonb not null default '[]'::jsonb,
  warnings       jsonb not null default '[]'::jsonb,
  error          text,
  input_tokens   int,
  output_tokens  int,
  created_at     timestamptz not null default now(),
  -- A redelivered pg_net POST for the same fire slot is a no-op (endpoint checks
  -- this first; the constraint is the backstop against a race).
  unique (board_agent_id, fire_date, fire_hour)
);
create index board_agent_runs_recent_idx
  on public.board_agent_runs (board_agent_id, created_at desc);

alter table public.board_agent_runs enable row level security;
create policy board_agent_runs_select on public.board_agent_runs
  for select to authenticated using (public.is_org_member(org_id));
-- No client write policy: rows are written ONLY by the service endpoint
-- (service_role bypasses RLS). Mirrors automation_runs.

-- ── 3) board_agent_fires (once-only fire ledger for the sweep) ────────────────
create table public.board_agent_fires (
  board_agent_id uuid not null references public.board_agents (id) on delete cascade,
  org_id         uuid not null references public.organizations (id) on delete cascade,
  fire_date      date not null,
  fire_hour      smallint not null default 0,
  fired_at       timestamptz not null default now(),
  primary key (board_agent_id, fire_date, fire_hour)
);
alter table public.board_agent_fires enable row level security;
create policy board_agent_fires_select on public.board_agent_fires
  for select to authenticated using (public.is_org_member(org_id));
-- No client write policy: rows written exclusively by the SECURITY DEFINER sweep.

-- ── 4) board_agent_apply — the confined applier (the ONLY write path) ─────────
-- The service endpoint hands each model-chosen action here. This re-applies the
-- SAME per-action confinement guards used by _automation_run, but for the AUTOPILOT
-- vocabulary only (move_to_group / set_percent / notify) — set_option, call_webhook
-- and any unknown type are dropped. notify authors an @mention comment + a
-- notification as the platform bot (truthful attribution; frozen-author-safe).
-- Returns the outcome text; the endpoint aggregates outcomes into board_agent_runs.
create or replace function public.board_agent_apply(
  p_agent uuid, p_item uuid, p_action jsonb
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_org     uuid;
  v_board   uuid;
  v_enabled boolean;
  v_bot     uuid;
  v_type    text;
  v_target  uuid;
  v_newval  jsonb;
  v_group   uuid;
  v_moved   int;
  v_rid     uuid;
  v_update  uuid;
begin
  select org_id, board_id, enabled into v_org, v_board, v_enabled
    from public.board_agents where id = p_agent;
  -- Kill switch / missing agent: never write.
  if not found or not v_enabled then
    return 'ai_skipped';
  end if;

  -- Confinement: the item must be a top-level item on THIS agent's board.
  if not exists (
    select 1 from public.items
    where id = p_item and board_id = v_board and parent_id is null
  ) then
    return 'ai_skipped_bad_target';
  end if;

  v_bot  := public.platform_agent_user_id();
  v_type := p_action->>'type';

  if v_type = 'move_to_group' then
    v_group := (p_action->>'groupId')::uuid;
    update public.items i
       set group_id = v_group,
           position = coalesce(
             (select max(i2.position) from public.items i2
               where i2.group_id = v_group and i2.parent_id is null), 0) + 1
     where i.id = p_item
       and i.parent_id is null
       and i.group_id is distinct from v_group
       and exists (
         select 1 from public.groups g where g.id = v_group and g.board_id = v_board
       );
    get diagnostics v_moved = row_count;
    return case when v_moved > 0 then 'ai_decided' else 'ai_skipped_bad_target' end;

  elsif v_type = 'set_percent' then
    v_target := (p_action->>'columnId')::uuid;
    if not exists (
      select 1 from public.columns where id = v_target and board_id = v_board
    ) then
      return 'ai_skipped_bad_target';
    end if;
    v_newval := jsonb_build_object('percent', (p_action->>'percent')::numeric);
    insert into public.cell_values (org_id, board_id, item_id, column_id, value)
    values (v_org, v_board, p_item, v_target, v_newval)
    on conflict (item_id, column_id) do update set value = excluded.value;
    return 'ai_decided';

  elsif v_type = 'notify' then
    if p_action#>>'{recipient,kind}' = 'member' then
      v_rid := (p_action#>>'{recipient,userId}')::uuid;
    else
      select (cv.value->'userIds'->>0)::uuid into v_rid
      from public.cell_values cv
      where cv.item_id = p_item
        and cv.column_id = (p_action#>>'{recipient,peopleColumnId}')::uuid;
    end if;
    if v_rid is null then
      return 'ai_skipped_no_recipient';
    elsif not public.is_member_of(v_rid, v_org) then
      return 'ai_skipped_not_member';
    end if;
    -- Author a comment AS the platform bot, then notify the owner (kind mention).
    insert into public.item_updates (org_id, board_id, item_id, author_id, body, body_text)
    values (
      v_org, v_board, p_item, v_bot,
      jsonb_build_object('text', 'Autopilot: this item is waiting on you.'),
      'Autopilot: this item is waiting on you.'
    )
    returning id into v_update;
    insert into public.notifications
      (org_id, recipient_id, actor_id, kind, board_id, item_id, update_id)
    values (v_org, v_rid, v_bot, 'mention', v_board, p_item, v_update);
    return 'ai_decided';

  else
    -- set_option / call_webhook / unknown are NEVER autopilot actions (spec §4.3).
    return 'ai_skipped_bad_type';
  end if;
exception when others then
  return 'ai_error';
end; $$;

-- Confined definer: only the service-role endpoint may call it. No client path.
revoke execute on function public.board_agent_apply(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.board_agent_apply(uuid, uuid, jsonb) to service_role;

-- ── 5) _autopilot_sweep — the schedule (copied from _automation_date_sweep) ────
-- Runs hourly. For every org, at the org's wall-clock hour: fire each enabled
-- agent that is due (daily => once at run_at_local_hour; hourly => every hour),
-- idempotently via the board_agent_fires ledger, with a signed net.http_post to
-- /api/ai/autopilot. Per-org failures are isolated (bad timezone => skip that org).
create or replace function public._autopilot_sweep(p_now timestamptz default now())
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org     record;
  v_agent   record;
  v_local   timestamp;
  v_today   date;
  v_hour    int;
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
        select id, board_id, org_id, cadence, run_at_local_hour
        from public.board_agents
        where org_id = v_org.id and enabled
      loop
        -- Daily agents fire once, at their configured local hour; hourly agents
        -- fire on every tick. (fire_hour keys the idempotency ledger below.)
        if v_agent.cadence = 'daily' and v_hour <> v_agent.run_at_local_hour then
          continue;
        end if;

        insert into public.board_agent_fires
          (board_agent_id, org_id, fire_date, fire_hour)
        values (v_agent.id, v_agent.org_id, v_today, v_hour)
        on conflict do nothing;

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
            url := v_app_url || '/api/ai/autopilot',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'X-Pulse-Signature', v_sig),
            body := v_body
          );
        end if;
      end loop;
    exception when others then
      raise warning 'autopilot sweep skipped org %: %', v_org.id, sqlerrm;
    end;
  end loop;
end; $$;

revoke execute on function public._autopilot_sweep(timestamptz)
  from public, anon, authenticated;

-- Hourly schedule. cron.schedule upserts by job name => migration is re-runnable.
select cron.schedule(
  'autopilot-sweep',
  '0 * * * *',
  $cron$ select public._autopilot_sweep() $cron$
);
