-- 20260720093437_item_embed_queue.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (Phase 10 · E5 · Task B2 — async embedding pipeline):
--   The F15 semantic index must never do model work on the hot write path
--   (the group.ts invariant). So item/comment writes only MARK staleness: a
--   lightweight AFTER trigger inserts a row into `item_embed_queue`
--   (on-conflict-do-nothing — zero model work). A pg_cron `embed-sweep` drains a
--   BOUNDED batch every 2 min and fires a signed `net.http_post` to
--   /api/ai/embed, which builds each item's composite document, skips unchanged
--   items (content_hash + model), embeds the rest, upserts `item_embeddings`,
--   and clears the queue rows. This reuses the EXACT pg_cron + pg_net + Vault
--   mechanism the health-digest / webhook paths use.
--   RLS: default-deny, no client access — the queue is an internal work list
--   owned by the triggers (definer) + the service-role endpoint.

create table public.item_embed_queue (
  item_id     uuid primary key references public.items (id) on delete cascade,
  org_id      uuid not null references public.organizations (id) on delete cascade,
  board_id    uuid not null references public.boards (id) on delete cascade,
  enqueued_at timestamptz not null default now()
);
-- The sweep selects oldest-first; a plain btree on enqueued_at drives the batch.
create index item_embed_queue_enqueued_idx on public.item_embed_queue (enqueued_at);

alter table public.item_embed_queue enable row level security;
-- Default-deny: NO policy for any client role. Only the SECURITY DEFINER enqueue
-- triggers and the service-role embed endpoint (RLS-bypassing) touch this table,
-- mirroring the service-only write posture of automation_ai_jobs. With zero
-- policies every authenticated/anon client sees nothing and cannot write.

-- ── Enqueue triggers (zero model work — hot-path safe) ──────────────────────
-- items.name change: enqueue the item itself.
create or replace function public.tg_enqueue_item_embed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.item_embed_queue (item_id, org_id, board_id)
  values (new.id, new.org_id, new.board_id)
  on conflict (item_id) do nothing;
  return null; -- AFTER trigger: return value is ignored.
end; $$;
revoke execute on function public.tg_enqueue_item_embed() from public, anon, authenticated;

drop trigger if exists trg_items_enqueue_embed on public.items;
create trigger trg_items_enqueue_embed
  after insert or update of name on public.items
  for each row execute function public.tg_enqueue_item_embed();

-- item_updates.body_text change (a comment): enqueue the PARENT item. item_updates
-- already carries org_id + board_id, so no lookup is needed.
create or replace function public.tg_enqueue_comment_embed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.item_embed_queue (item_id, org_id, board_id)
  values (new.item_id, new.org_id, new.board_id)
  on conflict (item_id) do nothing;
  return null;
end; $$;
revoke execute on function public.tg_enqueue_comment_embed() from public, anon, authenticated;

drop trigger if exists trg_item_updates_enqueue_embed on public.item_updates;
create trigger trg_item_updates_enqueue_embed
  after insert or update of body_text on public.item_updates
  for each row execute function public.tg_enqueue_comment_embed();

-- ── embed-sweep cron: drain a bounded batch → signed POST /api/ai/embed ──────
-- Reads app_url + the shared HMAC secret from Vault (parity with the health
-- digest's app_url/digest_secret). Signs the EXACT canonical body text pg_net
-- sends (jsonb::text is deterministic), matched by verifyBody(await req.text())
-- on the endpoint. Fire-and-forget: the endpoint clears drained rows; an
-- un-drained row simply re-sends next sweep (idempotent via content_hash).
create or replace function public._embed_sweep_ping() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url    text;
  v_secret text;
  v_batch  uuid[];
  v_body   jsonb;
  v_sig    text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'app_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'ai_pgnet_hmac_secret';
  if v_url is null or v_secret is null then
    raise notice 'embed-sweep: vault secrets app_url/ai_pgnet_hmac_secret missing; skipping';
    return;
  end if;

  select array_agg(item_id) into v_batch
  from (
    select item_id from public.item_embed_queue
    order by enqueued_at asc
    limit 50
  ) q;

  if v_batch is null then
    return; -- empty queue: nothing to do.
  end if;

  v_body := jsonb_build_object('mode', 'sweep', 'batch', to_jsonb(v_batch));
  v_sig  := encode(extensions.hmac(v_body::text, v_secret, 'sha256'), 'hex');

  perform net.http_post(
    url := v_url || '/api/ai/embed',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-pulse-signature', v_sig),
    body := v_body
  );
end; $$;
revoke execute on function public._embed_sweep_ping() from public, anon, authenticated;

-- Every 2 minutes; the job name is the upsert key (re-runnable migration).
select cron.schedule('embed-sweep', '*/2 * * * *',
  $cron$ select public._embed_sweep_ping() $cron$);
