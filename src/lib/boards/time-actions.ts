"use server";

import { createClient } from "@/lib/supabase/server";
import { resolveUserTimeZone } from "@/lib/datetime/user-timezone";
import { zonedWallTimeToUtc } from "@/lib/datetime/timezone";
import type { Tables } from "@/types/database.types";
import {
  addManualEntrySchema,
  deleteEntrySchema,
  editEntrySchema,
  setEstimateSchema,
  startTimerSchema,
  stopTimerSchema,
} from "@/lib/validations/board-actions";
import { type ActionResult, upsertCell, clearCell } from "@/lib/boards/actions";

type TimeEntry = Tables<"time_entries">;

function fail(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

async function itemBoard(
  supabase: Awaited<ReturnType<typeof createClient>>,
  itemId: string,
): Promise<{ orgId: string; boardId: string } | null> {
  const { data } = await supabase
    .from("items")
    .select("org_id, board_id")
    .eq("id", itemId)
    .maybeSingle();
  return data ? { orgId: data.org_id, boardId: data.board_id } : null;
}

/** Start a timer: stops the caller's running timer + starts a new one (RPC, atomic). */
export async function startTimer(input: {
  itemId: string;
  columnId: string;
}): Promise<ActionResult<{ entries: TimeEntry[] }>> {
  const parsed = startTimerSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const meta = await itemBoard(supabase, parsed.data.itemId);
  if (!meta) return fail("Item not found.");

  const { data, error } = await supabase.rpc("start_timer", {
    p_item_id: parsed.data.itemId,
    p_column_id: parsed.data.columnId,
  });
  if (error) return fail(error.message);
  return { ok: true, data: { entries: (data ?? []) as TimeEntry[] } };
}

/** Stop a running entry (own row via RLS). */
export async function stopTimer(input: {
  entryId: string;
}): Promise<ActionResult<{ entry: TimeEntry }>> {
  const parsed = stopTimerSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("time_entries")
    .select("started_at, board_id")
    .eq("id", parsed.data.entryId)
    .maybeSingle();
  if (!existing) return fail("Entry not found.");

  const durationSecs = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(existing.started_at)) / 1000),
  );
  const { data, error } = await supabase
    .from("time_entries")
    .update({ ended_at: new Date().toISOString(), duration_secs: durationSecs })
    .eq("id", parsed.data.entryId)
    .is("ended_at", null) // idempotent: only the still-running row
    .select("*")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Entry already stopped.");

  return { ok: true, data: { entry: data } };
}

/** Add a completed entry retroactively for a date. */
export async function addManualEntry(input: {
  itemId: string;
  columnId: string;
  date: string;
  durationSecs: number;
}): Promise<ActionResult<{ entry: TimeEntry }>> {
  const parsed = addManualEntrySchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const meta = await itemBoard(supabase, parsed.data.itemId);
  if (!meta) return fail("Item not found.");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  // Validate the column belongs to this board and is a time-tracking column.
  const { data: col } = await supabase
    .from("columns")
    .select("id, kind, board_id")
    .eq("id", parsed.data.columnId)
    .maybeSingle();
  if (!col || col.board_id !== meta.boardId || col.kind !== "time_tracking")
    return fail("Invalid time tracking column.");

  // Anchor the entry to MIDDAY in the user's timezone (not noon UTC), so it
  // buckets back onto the same local calendar day the user picked — agreeing
  // with the /time card read path (resolveUserTimeZone + zonedDayOf).
  const timeZone = await resolveUserTimeZone(user.id);
  const startedAt = zonedWallTimeToUtc(
    parsed.data.date,
    12,
    timeZone,
  ).toISOString();
  const endedAt = new Date(
    Date.parse(startedAt) + parsed.data.durationSecs * 1000,
  ).toISOString();

  const { data, error } = await supabase
    .from("time_entries")
    .insert({
      org_id: meta.orgId,
      board_id: meta.boardId,
      item_id: parsed.data.itemId,
      column_id: parsed.data.columnId,
      user_id: user.id,
      started_at: startedAt,
      ended_at: endedAt,
      duration_secs: parsed.data.durationSecs,
    })
    .select("*")
    .single();
  if (error || !data) return fail(error?.message ?? "Could not add time.");
  return { ok: true, data: { entry: data } };
}

/** Edit a completed entry's date + duration (own row via RLS). */
export async function editEntry(input: {
  entryId: string;
  date: string;
  durationSecs: number;
}): Promise<ActionResult<{ entry: TimeEntry }>> {
  const parsed = editEntrySchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  // Same midday-in-user-tz anchoring as addManualEntry, so an edited day
  // renders on that local day on the /time card (RLS scopes the row to self,
  // so the editor's tz is the owner's tz).
  const timeZone = await resolveUserTimeZone(user.id);
  const startedAt = zonedWallTimeToUtc(
    parsed.data.date,
    12,
    timeZone,
  ).toISOString();
  const endedAt = new Date(
    Date.parse(startedAt) + parsed.data.durationSecs * 1000,
  ).toISOString();

  const { data, error } = await supabase
    .from("time_entries")
    .update({
      started_at: startedAt,
      ended_at: endedAt,
      duration_secs: parsed.data.durationSecs,
    })
    .eq("id", parsed.data.entryId)
    .not("ended_at", "is", null) // only edit completed entries
    .select("*")
    .maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("Entry not found or still running.");

  return { ok: true, data: { entry: data } };
}

/** Delete an entry (own row via RLS). */
export async function deleteEntry(input: {
  entryId: string;
}): Promise<ActionResult<{ id: string }>> {
  const parsed = deleteEntrySchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  // No board_id read needed anymore (previously fetched only for a
  // revalidatePath, now dropped — the board client hydrates once and is kept
  // fresh by the optimistic remove + realtime, never by RSC revalidation).
  const { error } = await supabase
    .from("time_entries")
    .delete()
    .eq("id", parsed.data.entryId);
  if (error) return fail(error.message);

  return { ok: true, data: { id: parsed.data.entryId } };
}

/** Set or clear the per-item estimate (reuses the cell write path). */
export async function setEstimate(input: {
  itemId: string;
  columnId: string;
  estimateSeconds: number | null;
}): Promise<ActionResult<{ ok: true }>> {
  const parsed = setEstimateSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  if (parsed.data.estimateSeconds == null) {
    const res = await clearCell({
      itemId: parsed.data.itemId,
      columnId: parsed.data.columnId,
    });
    return res.ok ? { ok: true, data: { ok: true } } : fail(res.error);
  }

  const res = await upsertCell({
    itemId: parsed.data.itemId,
    columnId: parsed.data.columnId,
    value: { estimateSeconds: parsed.data.estimateSeconds },
  });
  return res.ok ? { ok: true, data: { ok: true } } : fail(res.error);
}
