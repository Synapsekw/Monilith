-- Performance hardening (finding #8): goal_links has org_id (denormalized,
-- FK to organizations, on delete cascade) but 20260621160000_goals.sql only
-- indexed goal_id and board_id. Add the missing org_id index so org-scoped
-- reads and the on-delete-cascade from organizations do not seq-scan.
create index if not exists goal_links_org_id_idx on public.goal_links (org_id);
