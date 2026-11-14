import * as z from "zod";
import { FOLDER_DATA_ERROR, type BurnRow, type LoadRow } from "./types";

/**
 * Unpackers for the single-value jsonb RPCs added by
 * supabase/migrations/20261114145347_folder_tower.sql. PostgREST caps every
 * response at max_rows = 1000; folder_burn's dense stage x week grid (DAAS:
 * 4,088 rows) and folder_load's 5,000-row bound both exceed it, so the
 * migration also returns each as ONE jsonb value:
 *
 *   folder_burn_packed → { lo, hi, stages: [stage_key…],
 *                          rows: [[stage_index, week_offset, planned,
 *                                  completed, imported_done, overdue_open]…] }
 *     only cells with a non-zero count; week_offset is whole weeks after lo.
 *   folder_load        → { weeks: [week_start…],
 *                          rows: [[board_id, stage_key, week_start, open_due]…] }
 *
 * Both fail CLOSED: any value that does not match exactly is a schema-drift
 * bug, logged once, and the caller gets FOLDER_DATA_ERROR (the panel's Retry),
 * never a partial series.
 */
export type Unpacked<T> =
  { ok: true; rows: T[] } | { ok: false; error: string };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int().nonnegative();

const burnPackedSchema = z.object({
  lo: isoDate.nullable(),
  hi: isoDate.nullable(),
  stages: z.array(z.string()),
  rows: z.array(z.tuple([count, count, count, count, count, count])),
});

const loadPackedSchema = z.object({
  weeks: z.array(isoDate),
  rows: z.array(
    z.tuple([z.string(), z.string(), isoDate, z.number().int().positive()]),
  ),
});

const DAY = 864e5;
const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY;
const isoOf = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);

function fail<T>(rpc: string, why: string): Unpacked<T> {
  console.error(`[folders] ${rpc} packed value rejected: ${why}`);
  return { ok: false, error: FOLDER_DATA_ERROR };
}

/** folder_burn_packed → the same dense `BurnRow[]` folder_burn returns
 *  (stage_key order, then week), zero-filled, so every consumer is unchanged. */
export function unpackBurnPacked(value: unknown): Unpacked<BurnRow> {
  const p = burnPackedSchema.safeParse(value);
  if (!p.success)
    return fail("folder_burn_packed", p.error.issues[0]?.message ?? "shape");
  const { lo, hi, stages, rows } = p.data;
  if (lo === null || hi === null) {
    if (lo !== hi) return fail("folder_burn_packed", "only one window bound");
    if (rows.length > 0 || stages.length > 0)
      return fail("folder_burn_packed", "cells without a window");
    return { ok: true, rows: [] };
  }
  const loDay = dayNumber(lo);
  const hiDay = dayNumber(hi);
  if (Number.isNaN(loDay) || Number.isNaN(hiDay))
    return fail("folder_burn_packed", "invalid date");
  if (hiDay < loDay || (hiDay - loDay) % 7 !== 0)
    return fail(
      "folder_burn_packed",
      "window is not whole weeks from lo to hi",
    );
  if (new Set(stages).size !== stages.length)
    return fail("folder_burn_packed", "repeated stage");
  const weeks = (hiDay - loDay) / 7 + 1;
  const cells = new Map<number, (typeof rows)[number]>();
  for (const r of rows) {
    const [si, wo] = r;
    if (si >= stages.length)
      return fail("folder_burn_packed", "unknown stage index");
    if (wo >= weeks)
      return fail("folder_burn_packed", "week outside the window");
    const k = si * weeks + wo;
    if (cells.has(k)) return fail("folder_burn_packed", "repeated cell");
    cells.set(k, r);
  }
  const out: BurnRow[] = [];
  stages.forEach((stageKey, si) => {
    for (let wo = 0; wo < weeks; wo++) {
      const c = cells.get(si * weeks + wo);
      out.push({
        stageKey,
        weekStart: isoOf(loDay + wo * 7),
        planned: c?.[2] ?? 0,
        completed: c?.[3] ?? 0,
        importedDone: c?.[4] ?? 0,
        overdueOpen: c?.[5] ?? 0,
      });
    }
  });
  return { ok: true, rows: out };
}

/** folder_load (jsonb) → `LoadRow[]`, in the RPC's board-position order. */
export function unpackLoadPacked(value: unknown): Unpacked<LoadRow> {
  const p = loadPackedSchema.safeParse(value);
  if (!p.success)
    return fail("folder_load", p.error.issues[0]?.message ?? "shape");
  const weeks = new Set(p.data.weeks);
  const seen = new Set<string>();
  const out: LoadRow[] = [];
  for (const [boardId, stageKey, weekStart, openDue] of p.data.rows) {
    if (!weeks.has(weekStart))
      return fail("folder_load", "week outside the window");
    const k = `${boardId}\u0000${stageKey}\u0000${weekStart}`;
    if (seen.has(k)) return fail("folder_load", "repeated cell");
    seen.add(k);
    out.push({ boardId, stageKey, weekStart, openDue });
  }
  return { ok: true, rows: out };
}
