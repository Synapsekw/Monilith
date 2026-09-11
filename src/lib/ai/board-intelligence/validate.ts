import { sanitizeInline } from "@/lib/ai/prompt-sanitize";
import type { SignalKind } from "@/lib/boards/intelligence/types";
import type { BoardContext } from "./board-context";
import {
  rawOutputSchema,
  type Action,
  type BoardIntelligencePayload,
  type RawAction,
} from "./schema";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SIGNAL_KINDS: readonly SignalKind[] = [
  "overdue",
  "overloaded",
  "stalled",
  "changed",
  "blocked",
];
const isSignalKind = (s: string): s is SignalKind =>
  (SIGNAL_KINDS as readonly string[]).includes(s);

/** Turn one flat model action into a member of the closed union, or null when
 *  any id is not on the board, the column kind does not fit, or a value is
 *  malformed. Labels are resolved HERE, once, so the dock needs no payload. */
export function toAction(raw: RawAction, ctx: BoardContext): Action | null {
  const item = (id: string | null) => (id ? ctx.items.get(id) : undefined);
  const col = (id: string | null, kind: string) => {
    const c = id ? ctx.columns.get(id) : undefined;
    return c && c.kind === kind ? c : undefined;
  };
  switch (raw.type) {
    case "reassign": {
      const ids = (raw.itemIds ?? []).filter((id) => ctx.items.has(id));
      const c = col(raw.columnId, "people");
      const name = raw.toUserId ? ctx.members.get(raw.toUserId) : undefined;
      if (ids.length === 0 || !c || !raw.toUserId || !name) return null;
      return {
        type: "reassign",
        itemIds: ids,
        columnId: c.id,
        toUserId: raw.toUserId,
        label: `Reassign ${ids.length === 1 ? (item(ids[0])?.name ?? "1 item") : `${ids.length} items`} to ${name}`,
      };
    }
    case "set_due": {
      const it = item(raw.itemId);
      const c = col(raw.columnId, "date");
      if (!it || !c || !raw.date || !ISO_DATE.test(raw.date)) return null;
      return {
        type: "set_due",
        itemId: it.id,
        columnId: c.id,
        date: raw.date,
        label: `Set ${c.name} to ${raw.date}`,
      };
    }
    case "set_status": {
      const it = item(raw.itemId);
      const c = col(raw.columnId, "status");
      const opt = c && raw.optionId ? c.options.get(raw.optionId) : undefined;
      if (!it || !c || !raw.optionId || !opt) return null;
      return {
        type: "set_status",
        itemId: it.id,
        columnId: c.id,
        optionId: raw.optionId,
        label: `Mark ${it.name} as ${opt}`,
      };
    }
    case "nudge": {
      const it = item(raw.itemId);
      const name = raw.userId ? ctx.members.get(raw.userId) : undefined;
      const message = raw.message
        ? sanitizeInline(raw.message).trim().slice(0, 280)
        : "";
      if (!it || !raw.userId || !name || message.length === 0) return null;
      return {
        type: "nudge",
        itemId: it.id,
        userId: raw.userId,
        message,
        label: `Nudge ${name}`,
      };
    }
    case "filter": {
      if (!raw.signalKind || !isSignalKind(raw.signalKind)) return null;
      return {
        type: "filter",
        signalKind: raw.signalKind,
        label: `Show ${raw.signalKind} rows`,
      };
    }
  }
}

/**
 * Validate the model's output against the board (spec §4.4): the raw shape
 * must parse (throws otherwise — the caller maps it to a user-facing error);
 * a suggestion survives only if at least one action survives `toAction`;
 * evidence rows resolve to real item names; ids are minted s1..sN in order.
 * The brief is kept even when zero suggestions survive.
 */
export function validateIntelligenceOutput(
  raw: unknown,
  ctx: BoardContext,
  signals: BoardIntelligencePayload["signals"],
): { payload: BoardIntelligencePayload; warnings: string[] } {
  const parsed = rawOutputSchema.parse(raw);
  const warnings: string[] = [];
  const suggestions: BoardIntelligencePayload["suggestions"] = [];
  for (const s of parsed.suggestions) {
    const actions = s.actions
      .map((a) => toAction(a, ctx))
      .filter((a): a is Action => a !== null);
    if (actions.length === 0) {
      warnings.push(`Dropped "${s.title}": no valid action`);
      continue;
    }
    if (actions.length < s.actions.length)
      warnings.push(
        `"${s.title}": dropped ${s.actions.length - actions.length} invalid action(s)`,
      );
    const evidenceRows = s.evidenceItemIds.flatMap((id) => {
      const it = ctx.items.get(id);
      return it ? [{ itemId: it.id, name: it.name, detail: "" }] : [];
    });
    suggestions.push({
      id: `s${suggestions.length + 1}`,
      kind: s.kind,
      title: sanitizeInline(s.title).slice(0, 80),
      evidence: sanitizeInline(s.evidence).slice(0, 40),
      body: sanitizeInline(s.body).slice(0, 240),
      evidenceRows,
      actions,
    });
  }
  return {
    payload: { brief: parsed.brief.trim(), suggestions, signals },
    warnings,
  };
}
