-- Advisor cleanup: cover every foreign key with a btree index, and document the
-- intentional platform_admins lockdown.
--
-- Performance advisor (`unindexed_foreign_keys`): an FK column with no covering
-- index forces sequential scans on the child table during joins and, more
-- importantly, on every DELETE/UPDATE of a referenced parent row (Postgres must
-- scan the child to enforce the constraint). All indexes below are additive and
-- single-column, matching the existing `<table>_<column>_idx` convention.
--
-- Security advisor (`rls_enabled_no_policy`) on platform_admins is intentional:
-- the table is RLS-enabled with NO policy so the API can never reach it; it is
-- read exclusively through SECURITY DEFINER functions (is_platform_admin(),
-- platform_stats()). We document that here rather than add a policy, which would
-- weaken the lockdown.

create index if not exists admin_audit_log_actor_id_idx on public.admin_audit_log (actor_id);
create index if not exists admin_audit_log_target_user_id_idx on public.admin_audit_log (target_user_id);
create index if not exists attachments_update_id_idx on public.attachments (update_id);
create index if not exists attachments_uploaded_by_idx on public.attachments (uploaded_by);
create index if not exists automation_date_fires_org_id_idx on public.automation_date_fires (org_id);
create index if not exists automation_runs_board_id_idx on public.automation_runs (board_id);
create index if not exists automation_runs_item_id_idx on public.automation_runs (item_id);
create index if not exists automation_runs_org_id_idx on public.automation_runs (org_id);
create index if not exists automation_webhook_deliveries_org_id_idx on public.automation_webhook_deliveries (org_id);
create index if not exists automation_webhook_deliveries_run_id_idx on public.automation_webhook_deliveries (run_id);
create index if not exists automations_created_by_idx on public.automations (created_by);
create index if not exists board_members_granted_by_idx on public.board_members (granted_by);
create index if not exists boards_created_by_idx on public.boards (created_by);
create index if not exists dashboard_widgets_source_board_id_idx on public.dashboard_widgets (source_board_id);
create index if not exists dashboards_created_by_idx on public.dashboards (created_by);
create index if not exists item_activities_actor_id_idx on public.item_activities (actor_id);
create index if not exists item_updates_author_id_idx on public.item_updates (author_id);
create index if not exists notifications_actor_id_idx on public.notifications (actor_id);
create index if not exists notifications_automation_id_idx on public.notifications (automation_id);
create index if not exists notifications_board_id_idx on public.notifications (board_id);
create index if not exists notifications_update_id_idx on public.notifications (update_id);
create index if not exists org_invitations_invited_by_idx on public.org_invitations (invited_by);
create index if not exists org_members_deactivated_by_idx on public.org_members (deactivated_by);
create index if not exists organizations_created_by_idx on public.organizations (created_by);
create index if not exists portfolio_boards_done_column_id_idx on public.portfolio_boards (done_column_id);
create index if not exists portfolio_boards_org_id_idx on public.portfolio_boards (org_id);
create index if not exists portfolio_boards_owner_user_id_idx on public.portfolio_boards (owner_user_id);
create index if not exists portfolios_created_by_idx on public.portfolios (created_by);
create index if not exists relation_links_org_id_idx on public.relation_links (org_id);
create index if not exists time_entries_org_id_idx on public.time_entries (org_id);
create index if not exists workspaces_created_by_idx on public.workspaces (created_by);

comment on table public.platform_admins is
  'Locked down by design: RLS enabled with NO policy so the API cannot reach it. '
  'Read only via SECURITY DEFINER functions is_platform_admin() and platform_stats(). '
  'The rls_enabled_no_policy advisor INFO is expected — do not add a policy.';
