-- org_ai_settings write confinement: tier/monthly_credit_limit are
-- platform-controlled entitlements. Client-side writes are removed entirely;
-- all writes flow through server actions (service role) behind explicit
-- has_org_role checks — same no-client-write posture as ai_usage.

drop policy if exists "org_ai_settings_insert_admin" on public.org_ai_settings;
drop policy if exists "org_ai_settings_update_admin" on public.org_ai_settings;
