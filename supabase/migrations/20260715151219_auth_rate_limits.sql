-- Auth rate limiting (deferred Audit Batch B).
--
-- A service-role-only fixed-window counter behind the four auth server actions
-- (signIn / signUp / requestPasswordReset / changeOwnPassword). The app calls
-- check_rate_limit() through the SERVICE client only, so the function is NOT
-- granted to anon/authenticated — nothing here is reachable from the browser or
-- PostgREST. The table holds only opaque sha256 bucket keys (no email, no raw
-- IP), so a leak reveals nothing about who was limited.

create table public.auth_rate_limits (
  bucket_key   text        primary key,
  count        integer     not null default 0,
  window_start timestamptz not null default now()
);

-- Default-deny for anon/authenticated: RLS on, no permissive policy. Only the
-- service role (which bypasses RLS) and the DEFINER function touch this table.
alter table public.auth_rate_limits enable row level security;

-- Fixed-window counter. Atomic single-row upsert keyed by bucket_key.
-- Returns (allowed, retry_after seconds, remaining).
create function public.check_rate_limit(
  p_key            text,
  p_limit          integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after integer, remaining integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count        integer;
  v_window_start timestamptz;
  v_now          timestamptz := now();
begin
  -- Opportunistic prune of this key's expired window happens implicitly via the
  -- reset branch below; a bulk prune of all-expired rows is a documented
  -- follow-up (table stays tiny at auth volume).
  insert into public.auth_rate_limits (bucket_key, count, window_start)
  values (p_key, 1, v_now)
  on conflict (bucket_key) do update
    set
      count = case
        when public.auth_rate_limits.window_start
             < v_now - make_interval(secs => p_window_seconds)
        then 1
        else public.auth_rate_limits.count + 1
      end,
      window_start = case
        when public.auth_rate_limits.window_start
             < v_now - make_interval(secs => p_window_seconds)
        then v_now
        else public.auth_rate_limits.window_start
      end
  returning count, window_start into v_count, v_window_start;

  allowed   := v_count <= p_limit;
  remaining := greatest(p_limit - v_count, 0);
  retry_after := case
    when allowed then 0
    else greatest(
      ceil(extract(epoch from (
        v_window_start + make_interval(secs => p_window_seconds) - v_now
      )))::integer,
      0
    )
  end;
  return next;
end;
$$;

-- Execution lockdown: service-role-only. Never anon/authenticated/public.
revoke execute on function public.check_rate_limit(text, integer, integer)
  from public, anon, authenticated;
