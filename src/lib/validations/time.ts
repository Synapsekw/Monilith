import { z } from "zod";

import { hoursToSecs } from "@/lib/time/hours";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date");
const hours = z.number().min(0).max(24);
const category = z.string().trim().min(1).max(120);
const note = z.string().max(500).optional();

/** Upsert one card cell. Exactly one of itemId / category must be set; hours > 0
 * (a 0 means "clear the cell" => use deleteTimeAllocationSchema). The transform
 * adds the derived durationSecs so the action never re-derives it. */
export const upsertTimeAllocationSchema = z
  .object({
    workDate: isoDate,
    itemId: uuid.optional(),
    boardId: uuid.optional(),
    category: category.optional(),
    hours,
    note,
  })
  .refine((v) => (v.itemId != null) !== (v.category != null), {
    message: "Set exactly one of item or category.",
  })
  .refine((v) => v.category == null || v.boardId == null, {
    message: "A category row carries no board.",
  })
  .refine((v) => v.hours > 0, {
    message: "Hours must be greater than 0 (clear the cell to remove time).",
  })
  .transform((v) => ({ ...v, durationSecs: hoursToSecs(v.hours) }));

/** Delete one card cell, keyed by (workDate, itemId|category). */
export const deleteTimeAllocationSchema = z
  .object({
    workDate: isoDate,
    itemId: uuid.optional(),
    category: category.optional(),
  })
  .refine((v) => (v.itemId != null) !== (v.category != null), {
    message: "Set exactly one of item or category.",
  });
