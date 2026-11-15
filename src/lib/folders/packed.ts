import * as z from "zod";
import {
  FOLDER_DATA_ERROR,
  type BurnPacked,
  type BurnRow,
  type LoadRow,
} from "./types";

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
 *
 * Client-safe on purpose (no server-only imports): the server validates the
 * packed burn with `parseBurnPacked` and ships it packed; the browser expands
 * it once with `burnRowsOf`.
 */
export type Unpacked<T> =
  { ok: true; rows: T[] } | { ok: false; error: string };

/** Size bounds, so a malformed value cannot allocate without limit. */
export const MAX_BURN_WEEKS = 104;
export const MAX_BURN_STAGES = 2000;
export const MAX_LOAD_ROWS = 5000;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int().nonnegative();

const burnPackedSchema = z.object({
  lo: isoDate.nullable(),
  hi: isoDate.nullable(),
  stages: z.array(z.string()).max(MAX_BURN_STAGES),
  rows: z.array(z.tuple([count, count, count, count, count, count])),
});

const loadPackedSchema = z.object({
  weeks: z.array(isoDate),
  rows: z
    .array(
      z.tuple([z.string(), z.string(), isoDate, z.number().int().positive()]),
    )
    .max(MAX_LOAD_ROWS),
});

const DAY = 864e5;
const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY;
const isoOf = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);

function reject(rpc: string, why: string): { ok: false; error: string } {
  console.error(`[folders] ${rpc} packed value rejected: ${why}`);
  return { ok: false, error: FOLDER_DATA_ERROR };
}

/**
 * Validates folder_burn_packed's value WITHOUT expanding it: the shape, a
 * window of whole weeks no wider than MAX_BURN_WEEKS between lo and hi, at
 * most MAX_BURN_STAGES stages, no more rows than stages × weeks, every cell
 * inside the grid and none repeated.
 */
export function parseBurnPacked(
  value: unknown,
): { ok: true; packed: BurnPacked } | { ok: false; error: string } {
  const p = burnPackedSchema.safeParse(value);
  if (!p.success)
    return reject("folder_burn_packed", p.error.issues[0]?.message ?? "shape");
  const { lo, hi, stages, rows } = p.data;
  if (lo === null || hi === null) {
    if (lo !== hi) return reject("folder_burn_packed", "only one window bound");
    if (rows.length > 0 || stages.length > 0)
      return reject("folder_burn_packed", "cells without a window");
    return { ok: true, packed: p.data };
  }
  const loDay = dayNumber(lo);
  const hiDay = dayNumber(hi);
  if (Number.isNaN(loDay) || Number.isNaN(hiDay))
    return reject("folder_burn_packed", "invalid date");
  if (hiDay < loDay || (hiDay - loDay) % 7 !== 0)
    return reject(
      "folder_burn_packed",
      "window is not whole weeks from lo to hi",
    );
  const span = (hiDay - loDay) / 7;
  if (span > MAX_BURN_WEEKS)
    return reject("folder_burn_packed", "window wider than the bound");
  const weeks = span + 1;
  if (rows.length > stages.length * weeks)
    return reject("folder_burn_packed", "more rows than cells");
  if (new Set(stages).size !== stages.length)
    return reject("folder_burn_packed", "repeated stage");
  const seen = new Set<number>();
  for (const [si, wo] of rows) {
    if (si >= stages.length)
      return reject("folder_burn_packed", "unknown stage index");
    if (wo >= weeks)
      return reject("folder_burn_packed", "week outside the window");
    const k = si * weeks + wo;
    if (seen.has(k)) return reject("folder_burn_packed", "repeated cell");
    seen.add(k);
  }
  return { ok: true, packed: p.data };
}

/** folder_burn_packed → the same dense `BurnRow[]` folder_burn returns
 *  (stage_key order, then week), zero-filled, so every consumer is unchanged. */
export function unpackBurnPacked(value: unknown): Unpacked<BurnRow> {
  const p = parseBurnPacked(value);
  if (!p.ok) return p;
  const { lo, hi, stages, rows } = p.packed;
  if (lo === null || hi === null) return { ok: true, rows: [] };
  const loDay = dayNumber(lo);
  const weeks = (dayNumber(hi) - loDay) / 7 + 1;
  const cells = new Map<number, (typeof rows)[number]>();
  for (const r of rows) cells.set(r[0] * weeks + r[1], r);
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

/** The browser side of the packed payload: a null value (not requested or
 *  failed) or one that does not unpack gives null, the panel's Retry. */
export function burnRowsOf(packed: BurnPacked | null): BurnRow[] | null {
  if (packed === null) return null;
  const u = unpackBurnPacked(packed);
  return u.ok ? u.rows : null;
}

/** folder_load (jsonb) → `LoadRow[]` in the RPC's board-position order, plus
 *  the server's week columns, which the heat map draws as they are. */
export function unpackLoadPacked(
  value: unknown,
):
  | { ok: true; weeks: string[]; rows: LoadRow[] }
  | { ok: false; error: string } {
  const p = loadPackedSchema.safeParse(value);
  if (!p.success)
    return reject("folder_load", p.error.issues[0]?.message ?? "shape");
  const weeks = new Set(p.data.weeks);
  const seen = new Set<string>();
  const out: LoadRow[] = [];
  for (const [boardId, stageKey, weekStart, openDue] of p.data.rows) {
    if (!weeks.has(weekStart))
      return reject("folder_load", "week outside the window");
    const k = `${boardId}\u0000${stageKey}\u0000${weekStart}`;
    if (seen.has(k)) return reject("folder_load", "repeated cell");
    seen.add(k);
    out.push({ boardId, stageKey, weekStart, openDue });
  }
  return { ok: true, weeks: p.data.weeks, rows: out };
}
