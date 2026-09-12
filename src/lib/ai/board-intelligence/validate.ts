import { sanitizeInline } from "@/lib/ai/prompt-sanitize";
import { SIGNAL_KINDS } from "@/lib/boards/intelligence/constants";
import type { Signal, SignalKind } from "@/lib/boards/intelligence/types";
import type { BoardContext } from "./board-context";
import {
  payloadSchema,
  rawOutputSchema,
  type Action,
  type BoardIntelligencePayload,
  type RawAction,
} from "./schema";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isSignalKind = (s: string): s is SignalKind =>
  (SIGNAL_KINDS as readonly string[]).includes(s);

/** The action union caps `label` at 60 chars (`actionSchema`/`payloadSchema`).
 *  Labels are built from real board data — item/column/member names have no
 *  such cap — so every constructed label MUST be run through this before it
 *  is returned, or a long name silently makes the whole run fail closed on
 *  read (`payloadSchema.parse` in the store). */
const MAX_LABEL = 60;
function capLabel(text: string): string {
  return text.length <= MAX_LABEL ? text : `${text.slice(0, MAX_LABEL - 1)}…`;
}

/**
 * Why one action was refused — a CONSTANT string per failure class, never
 * interpolated with model output.
 *
 * These reach a server log, and the run they explain is the only evidence we
 * have about whether the model is grounding well. "dropped 1 invalid action(s)"
 * could not distinguish a hallucinated item id from a column-kind mismatch from
 * a malformed date, which made the reasoning-effort level impossible to tune on
 * evidence rather than feel.
 *
 * "Missing" and "invented" are deliberately SEPARATE reasons wherever the
 * field is required-and-nullable in the model-facing JSON Schema. `optionId:
 * null` is a structured-output failure; a plausible-looking id that is not on
 * the column is a grounding failure. They call for opposite fixes — a prompt
 * change versus less aggressive reasoning — so a log that spelled them the
 * same way would answer the wrong question.
 */
export type ActionRejection =
  | "reassign: no itemIds on this board"
  | "reassign: columnId is not a people column on this board"
  | "reassign: toUserId is missing"
  | "reassign: toUserId is not a member of this org"
  | "set_due: itemId is not on this board"
  | "set_due: columnId is not a date column on this board"
  | "set_due: date is missing or not YYYY-MM-DD"
  | "set_status: itemId is not on this board"
  | "set_status: columnId is not a status column on this board"
  | "set_status: optionId is missing"
  | "set_status: optionId is not an option on that column"
  | "nudge: itemId is not on this board"
  | "nudge: userId is missing"
  | "nudge: userId is not a member of this org"
  | "nudge: message is empty after sanitising"
  | "filter: signalKind is not a known signal"
  | "filter: overloaded, but this run has no overloaded signal";

export type ActionParse =
  { ok: true; action: Action } | { ok: false; reason: ActionRejection };

const reject = (reason: ActionRejection): ActionParse => ({
  ok: false,
  reason,
});

/**
 * Turn one flat model action into a member of the closed union, or say WHY it
 * cannot be: any id not on the board, a column kind that does not fit, or a
 * malformed value. Labels are resolved HERE, once, so the dock needs no payload.
 *
 * `toAction` below is the null-returning form every other caller uses; this is
 * the same logic with the reason kept instead of discarded, so there is one
 * implementation and the two can never disagree.
 */
export function toActionParse(raw: RawAction, ctx: BoardContext): ActionParse {
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
      if (ids.length === 0) return reject("reassign: no itemIds on this board");
      if (!c)
        return reject(
          "reassign: columnId is not a people column on this board",
        );
      if (!raw.toUserId) return reject("reassign: toUserId is missing");
      if (!name)
        return reject("reassign: toUserId is not a member of this org");
      return {
        ok: true,
        action: {
          type: "reassign",
          itemIds: ids,
          columnId: c.id,
          toUserId: raw.toUserId,
          label: capLabel(
            `Reassign ${ids.length === 1 ? (item(ids[0])?.name ?? "1 item") : `${ids.length} items`} to ${name}`,
          ),
        },
      };
    }
    case "set_due": {
      const it = item(raw.itemId);
      const c = col(raw.columnId, "date");
      if (!it) return reject("set_due: itemId is not on this board");
      if (!c)
        return reject("set_due: columnId is not a date column on this board");
      if (!raw.date || !ISO_DATE.test(raw.date))
        return reject("set_due: date is missing or not YYYY-MM-DD");
      return {
        ok: true,
        action: {
          type: "set_due",
          itemId: it.id,
          columnId: c.id,
          date: raw.date,
          label: capLabel(`Set ${c.name} to ${raw.date}`),
        },
      };
    }
    case "set_status": {
      const it = item(raw.itemId);
      const c = col(raw.columnId, "status");
      const opt = c && raw.optionId ? c.options.get(raw.optionId) : undefined;
      if (!it) return reject("set_status: itemId is not on this board");
      if (!c)
        return reject(
          "set_status: columnId is not a status column on this board",
        );
      if (!raw.optionId) return reject("set_status: optionId is missing");
      if (!opt)
        return reject("set_status: optionId is not an option on that column");
      return {
        ok: true,
        action: {
          type: "set_status",
          itemId: it.id,
          columnId: c.id,
          optionId: raw.optionId,
          label: capLabel(`Mark ${it.name} as ${opt}`),
        },
      };
    }
    case "nudge": {
      const it = item(raw.itemId);
      const name = raw.userId ? ctx.members.get(raw.userId) : undefined;
      const message = raw.message
        ? sanitizeInline(raw.message).trim().slice(0, 280)
        : "";
      if (!it) return reject("nudge: itemId is not on this board");
      if (!raw.userId) return reject("nudge: userId is missing");
      if (!name) return reject("nudge: userId is not a member of this org");
      if (message.length === 0)
        return reject("nudge: message is empty after sanitising");
      return {
        ok: true,
        action: {
          type: "nudge",
          itemId: it.id,
          userId: raw.userId,
          message,
          label: capLabel(`Nudge ${name}`),
        },
      };
    }
    case "filter": {
      if (!raw.signalKind || !isSignalKind(raw.signalKind))
        return reject("filter: signalKind is not a known signal");
      // `overloaded` is the one per-PERSON signal: the strip's chip selects
      // `{ kind, subject }`, so a filter with no subject selects nothing and
      // the button does nothing. The subject is not the model's to invent —
      // it is read from the run's own signals (the first overloaded person,
      // which is the most overloaded one: `computeSignals` orders them).
      if (raw.signalKind === "overloaded") {
        const subject = ctx.signals.find(
          (s) => s.kind === "overloaded",
        )?.subjectUserId;
        if (!subject)
          return reject(
            "filter: overloaded, but this run has no overloaded signal",
          );
        return {
          ok: true,
          action: {
            type: "filter",
            signalKind: "overloaded",
            subject,
            label: capLabel(
              `Show overloaded rows · ${ctx.members.get(subject) ?? "someone"}`,
            ),
          },
        };
      }
      return {
        ok: true,
        action: {
          type: "filter",
          signalKind: raw.signalKind,
          label: `Show ${raw.signalKind} rows`,
        },
      };
    }
  }
}

/**
 * The model's OWN counts, read off the raw payload BEFORE `rawOutputSchema`
 * sees it.
 *
 * `cappedArray` truncates silently (deliberately — a cap the model was never
 * told must never fail a metered run, gotcha-103). That makes every count taken
 * after the parse post-truncation, so a model returning nine suggestions would
 * be logged as having proposed five, and a model whose five survivors are all
 * valid would log nothing at all — the four it lost leaving no trace. A drop
 * rate measured against a number the cap already flattened is not a drop rate.
 *
 * Defensive on shape because this runs before validation: anything unexpected
 * yields `null`, and the caller falls back to the post-parse count rather than
 * inventing one.
 */
function proposedCounts(raw: unknown): {
  suggestions: number | null;
  actions: (number | null)[];
} {
  const list = (raw as { suggestions?: unknown } | null | undefined)
    ?.suggestions;
  if (!Array.isArray(list)) return { suggestions: null, actions: [] };
  return {
    suggestions: list.length,
    actions: list.map((s) => {
      const a = (s as { actions?: unknown } | null | undefined)?.actions;
      return Array.isArray(a) ? a.length : null;
    }),
  };
}

/** The null-returning form: every caller that only needs "did it survive?".
 *  A thin wrapper over {@link toActionParse} so there is one implementation. */
export function toAction(raw: RawAction, ctx: BoardContext): Action | null {
  const parsed = toActionParse(raw, ctx);
  return parsed.ok ? parsed.action : null;
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
  /** The FULL signal rows (not the stored triples): `toAction` needs
   *  `subjectUserId` to resolve an `overloaded` filter, and the caller must
   *  not have to pass the same list twice in two shapes. */
  signals: readonly Signal[],
): {
  payload: BoardIntelligencePayload;
  warnings: string[];
  /** How many suggestions the MODEL proposed — counted before the schema's own
   *  cap truncated the list, so it is the model's number and not ours. Not
   *  derivable from `warnings.length` either: a warning can describe a card
   *  that survived with fewer actions. The drop RATE is what says whether the
   *  model is grounding well, and a rate needs an honest denominator. */
  proposed: number;
} {
  const counts = proposedCounts(raw);
  const parsed = rawOutputSchema.parse(raw);
  const warnings: string[] = [];
  const proposed = counts.suggestions ?? parsed.suggestions.length;
  // The cap firing is itself a signal — the model was told the limit and
  // exceeded it — and without this the silently-discarded cards are invisible
  // in a run that otherwise looks clean.
  if (proposed > parsed.suggestions.length)
    warnings.push(
      `Model proposed ${proposed} suggestions; the schema kept the first ${parsed.suggestions.length}`,
    );
  const suggestions: BoardIntelligencePayload["suggestions"] = [];
  for (const [i, s] of parsed.suggestions.entries()) {
    // The title is MODEL OUTPUT and reaches a server log below. Sanitise it
    // before it is interpolated, not only before it is stored: a raw title
    // carrying a newline or carriage return made two separate warnings render
    // as one mangled line, which is precisely when the log was needed most.
    //
    // `rawOutputSchema` deliberately does not require a non-empty title (a cap
    // the model was never told must never fail a metered run) — but the STORED
    // `suggestionSchema` does, so an untitled card is dropped below, like one
    // with no valid action, rather than tripping the safety net at the end.
    const title = sanitizeInline(s.title).trim().slice(0, 80);
    // Checked BEFORE the actions: an untitled card is dropped whatever its
    // actions do, so testing it here emits one attributable line instead of
    // two — the first of which used to describe a card called "" as though it
    // had survived.
    if (title.length === 0) {
      warnings.push("Dropped an untitled suggestion");
      continue;
    }
    const parses = s.actions.map((a) => toActionParse(a, ctx));
    const actions = parses.flatMap((p) => (p.ok ? [p.action] : []));
    const rejections = parses.flatMap((p) => (p.ok ? [] : [p.reason]));
    // Same reasoning as `proposed` above: `s.actions.length` is already
    // truncated, so quoting it would understate what the model actually sent.
    const proposedActions = counts.actions[i] ?? s.actions.length;
    const cappedOut = Math.max(0, proposedActions - s.actions.length);
    // The cap counts as a loss like any other, so it belongs in the reason
    // list. Reporting "kept X of Y" rather than "dropped X of Y" keeps the two
    // numbers over the SAME population: a rejection count measured against a
    // proposal count that also includes cap-truncated actions read as
    // "dropped 0 of 3" while one of the three was in fact dropped.
    const notes = cappedOut
      ? [...rejections, `${cappedOut} more dropped by the schema cap`]
      : rejections;
    if (actions.length === 0) {
      warnings.push(
        `Dropped "${title}": no valid action — ${notes.join("; ") || "the model proposed none"}`,
      );
      continue;
    }
    if (notes.length)
      warnings.push(
        `"${title}": kept ${actions.length} of ${proposedActions} action(s) — ${notes.join("; ")}`,
      );
    const evidenceRows = s.evidenceItemIds.flatMap((id) => {
      const it = ctx.items.get(id);
      return it ? [{ itemId: it.id, name: it.name, detail: "" }] : [];
    });
    suggestions.push({
      id: `s${suggestions.length + 1}`,
      kind: s.kind,
      title,
      evidence: sanitizeInline(s.evidence).slice(0, 40),
      body: sanitizeInline(s.body).slice(0, 240),
      evidenceRows,
      actions,
    });
  }
  const payload: BoardIntelligencePayload = {
    brief: parsed.brief.trim(),
    suggestions,
    signals: signals.map((s) => ({
      kind: s.kind,
      count: s.count,
      label: s.label,
    })),
  };
  // Safety net: everything above is built from real board data (item/column/
  // member names have no length cap), so re-run the exact schema the STORE
  // will parse on read. A payload that fails here would otherwise be written
  // once and then read back as "no run" forever (payloadSchema fails closed) —
  // better to throw now, with a message that points at what's wrong.
  const validated = payloadSchema.safeParse(payload);
  if (!validated.success)
    throw new Error(
      `validateIntelligenceOutput built a payload payloadSchema rejects: ${validated.error.message}`,
    );
  return {
    payload: validated.data,
    warnings,
    proposed,
  };
}
