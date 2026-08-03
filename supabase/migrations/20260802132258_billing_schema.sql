-- 20260802132258_billing_schema.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does (Phase 10 E6 · Unit A):
--   1) org_billing — the Stripe subscription mirror, one row per org.
--   2) billing_discount_codes — platform-admin codes mirrored from Stripe.
--   3) get_org_billing_status() — the ONLY tenant-facing read of either.
--
-- Both tables are DENY-ALL to authenticated and anon. org_billing carries Stripe
-- customer/subscription ids; billing_discount_codes is, in effect, free money.
-- Neither is tenant-readable under any policy. RLS is enabled with NO policies at
-- all — that is the deny, and it is deliberate, not an omission. Writes come
-- exclusively from the service role (the Stripe webhook, Unit C), which bypasses
-- RLS.
--
-- The org reads its own billing state through get_org_billing_status(), a
-- SECURITY DEFINER function returning the customer-facing fields ONLY.

-- ---------------------------------------------------------------------------
-- 1. org_billing — one row per organization, mirroring the Stripe subscription.
-- ---------------------------------------------------------------------------
create table if not exists public.org_billing (
  org_id                 uuid primary key references public.organizations (id) on delete cascade,
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  -- Lockstep with setOrgAiPlanSchema's enum (src/lib/validations/admin.ts).
  tier                   text not null default 'none'
                           check (tier in ('none', 'core', 'pulse', 'trial', 'enterprise')),
  -- Mirrors Stripe's subscription status, plus 'none' (never subscribed) and
  -- 'grace' (cancelled, inside the 30-day read-only window).
  status                 text not null default 'none'
                           check (status in ('none', 'trialing', 'active', 'past_due', 'canceled', 'grace')),
  cadence                text check (cadence in ('monthly', 'annual')),
  seats                  integer not null default 0 check (seats >= 0),
  current_period_end     timestamptz,
  trial_ends_at          timestamptz,
  grace_ends_at          timestamptz,
  -- The promotion code applied at checkout, mirrored for display. Deliberately
  -- NOT a foreign key: a code may be revoked and deleted while the discount it
  -- granted lives on in Stripe and on the invoice.
  discount_code          text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

alter table public.org_billing enable row level security;
-- No policies. Default-deny IS the policy.

drop trigger if exists org_billing_set_updated_at on public.org_billing;

create trigger org_billing_set_updated_at
  before update on public.org_billing
  for each row execute function public.set_updated_at();

comment on table public.org_billing is
  'Stripe subscription mirror, one row per org. Deny-all RLS: service-role writes only; orgs read via get_org_billing_status().';

-- ---------------------------------------------------------------------------
-- 2. billing_discount_codes — platform-admin-issued codes, mirrored from Stripe.
-- ---------------------------------------------------------------------------
-- max_redemptions defaults to 1: the single-recipient case is the common one,
-- and a code that is accidentally multi-use is money.
create table if not exists public.billing_discount_codes (
  id                       uuid primary key default gen_random_uuid(),
  code                     text not null unique,
  stripe_coupon_id         text,
  stripe_promotion_code_id text,
  percent_off              integer not null check (percent_off between 1 and 100),
  -- Stripe's `once` duration is DELIBERATELY not representable here. On a
  -- monthly plan `once` means one month free; on an annual plan the identical
  -- coupon means a whole YEAR free — 12x the giveaway from the same admin
  -- click. Duration is therefore always months-or-forever.
  duration                 text not null check (duration in ('repeating', 'forever')),
  duration_in_months       integer check (duration_in_months > 0),
  -- Sub-12-month durations are cadence-unsafe (see above) and must be recorded
  -- as monthly-only. Multiples of 12 cost the same either way.
  applies_to_cadence       text not null default 'both'
                             check (applies_to_cadence in ('monthly', 'annual', 'both')),
  plan_restriction         text check (plan_restriction in ('core', 'pulse')),
  max_redemptions          integer not null default 1 check (max_redemptions > 0),
  times_redeemed           integer not null default 0 check (times_redeemed >= 0),
  expires_at               timestamptz,
  created_by               uuid,
  note                     text,
  redeemed_by_org_id       uuid references public.organizations (id) on delete set null,
  redeemed_at              timestamptz,
  revoked_at               timestamptz,
  created_at               timestamptz not null default now(),
  constraint billing_discount_codes_repeating_needs_months check (
    duration <> 'repeating' or duration_in_months is not null
  ),
  -- The trap, enforced in the database rather than only in the admin UI: a
  -- sub-12-month code applied to an annual price multiplies the giveaway.
  constraint billing_discount_codes_short_duration_is_monthly_only check (
    duration <> 'repeating'
    or duration_in_months % 12 = 0
    or applies_to_cadence = 'monthly'
  )
);

alter table public.billing_discount_codes enable row level security;
-- No policies. Default-deny IS the policy.

-- Bounded admin list: 50 per page ordered by created_at desc (working agreement #5).
create index if not exists billing_discount_codes_created_idx
  on public.billing_discount_codes (created_at desc);

comment on table public.billing_discount_codes is
  'Platform-admin discount codes mirrored from Stripe Coupons + Promotion Codes. Deny-all RLS: effectively free money, never tenant-readable.';

-- ---------------------------------------------------------------------------
-- 3. get_org_billing_status — the ONLY tenant-facing read.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because org_billing is deny-all; the membership check in the
-- body is therefore load-bearing, not a query hint. It returns the seven
-- customer-facing fields and deliberately omits stripe_customer_id and
-- stripe_subscription_id — a definer that returned them would hand every org
-- member the identifiers needed to open a Stripe Billing Portal session.
--
-- An org with no row is not an error: it returns a single synthetic row at
-- ('none','none'), so callers never branch on empty-vs-absent.
create or replace function public.get_org_billing_status(p_org uuid)
returns table (
  tier               text,
  status             text,
  cadence            text,
  seats              integer,
  current_period_end timestamptz,
  trial_ends_at      timestamptz,
  grace_ends_at      timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_org_member(p_org) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  return query
    select coalesce(b.tier, 'none'),
           coalesce(b.status, 'none'),
           b.cadence,
           coalesce(b.seats, 0),
           b.current_period_end,
           b.trial_ends_at,
           b.grace_ends_at
    from (select 1) as one
    left join public.org_billing b on b.org_id = p_org;
end;
$$;

-- Default EXECUTE is granted to PUBLIC; strip it and hand it back to signed-in
-- callers only. `anon` must stay unable to reach any function
-- (ANON_REACHABLE_FUNCTION_ALLOWLIST is empty by design — see
-- src/test/anon-conformance.ts and 20260725102610_definer_acl_lockdown.sql).
revoke all on function public.get_org_billing_status(uuid) from public, anon;
grant execute on function public.get_org_billing_status(uuid) to authenticated;

comment on function public.get_org_billing_status(uuid) is
  'Customer-facing billing state for an org the caller belongs to. SECURITY DEFINER over a deny-all table; never returns Stripe ids.';
