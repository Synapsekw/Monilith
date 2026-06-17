-- Phase 4c follow-up: index the board_id cascade FK on attachments.
-- Mirrors the notifications.item_id cascade-FK index from Phase 4b
-- (commit 730038a). Without it, deleting a board sequential-scans attachments
-- during cascade cleanup. Hot-path reads use attachments_item_id_idx; this
-- covers the board_id FK the linter/MCP flagged as the one unindexed gap.
create index attachments_board_id_idx on public.attachments (board_id);
