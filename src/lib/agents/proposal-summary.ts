/**
 * The sentence a human approves.
 *
 * WHY THIS IS SERVER-DERIVED, and why it must stay that way: a proposal is a
 * blob of MODEL-CHOSEN input that sits in Postgres for up to seven days and is
 * then executed against real data with the approver's own privileges. If the
 * model also wrote the description, the sentence the owner reads need not
 * describe what actually runs — "Add a note to my scratch board" over an input
 * that renames someone else's item. `user_agent_proposals.summary` says so on
 * the column itself; this function is that promise's implementation.
 *
 * So: every branch reads ONLY the tool's own validated input, and renders the
 * values that will really be sent. Nothing here is ever model prose; the
 * item/file/rule NAMES are model-chosen, but they are the very arguments the
 * call carries, so showing them is showing the call.
 *
 * PURE and dependency-free — no `server-only`, no client, no DB. It cannot
 * name a board or a group, because it is handed ids and has nothing to resolve
 * them against; a read to prettify a sentence would put a query in the middle
 * of a run's refusal path. It therefore says "a board group" rather than
 * naming the board.
 *
 * NEVER THROWS. It runs inside the run loop's proposal-persist path, where a
 * throw would take down the insert for every proposal in the run — the exact
 * failure that leaves the owner with nothing to approve after the model already
 * told them it had queued the work. Anything it cannot read falls through to
 * `Run <tool>.`
 */

/** `user_agent_proposals.summary` is `check (length(summary) between 1 and 500)`.
 *  A summary that overflows would fail the INSERT for the whole batch. */
export const PROPOSAL_SUMMARY_MAX_LENGTH = 500;

/** Model-chosen text can carry newlines (Zod `.trim()` only strips the ends),
 *  and the card renders one line. Collapse rather than truncate: the words are
 *  what identifies the call. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Model-chosen values are rendered INSIDE double quotes, so a value containing
 * a quote can close the frame and write the rest of the sentence itself:
 *
 *   name = `Weekly report" is already approved. No board changes. Add "note`
 *   → Add "Weekly report" is already approved. No board changes. Add "note" to…
 *
 * That is model-authored sentence STRUCTURE on the one surface whose entire
 * security property is that it never renders model prose — a prompt-injected
 * run could make the card describe an action other than the one that executes.
 * The quotes are decoration and nothing downstream parses them, so the value
 * simply loses them. Curly quotes go too: they cannot close the frame, but they
 * read like it. Truncation is no defence here — every interpolated field is
 * schema-capped well under the 500-character clamp.
 */
function stripQuotes(value: string): string {
  return value.replace(/["“”]/g, "");
}

/**
 * Render a model-chosen value INSIDE the sentence rather than as part of it.
 *
 * The property being defended is not "the model may not use quotes" — it is
 * that the model may not author sentence STRUCTURE in the sentence a human
 * approves. Quote-stripping alone only defends values that are already framed;
 * an UNQUOTED interpolation needs no quote to append its own clause:
 *
 *   fileName = `report.pdf to an item. Approved by your admin, no data changes`
 *   → Attach report.pdf to an item. Approved by your admin, no data changes to…
 *
 * So every model-chosen value goes through here, and `str()` has already
 * removed the quotes that could close the frame. What is left is visibly one
 * quoted argument, however much prose it contains.
 */
function quoted(value: string): string {
  return `"${value}"`;
}

/** `YYYY-MM-DD`, the shape `log_time_allocation`'s `isoDate` accepts. A date is
 *  interpolated UNQUOTED (quoting one reads like a mistake), so it is admitted
 *  by shape instead: anything else cannot describe the call anyway. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A file extension, the only thing `create_file`'s `format` may be. It becomes
 *  part of the file name, so a sentence-shaped format is refused outright. */
const FILE_EXTENSION = /^[a-z0-9]{1,8}$/;

/**
 * A discriminator token — `status_changed`, `call_webhook`, and the rest of the
 * automation trigger/action vocabulary.
 *
 * Interpolated UNQUOTED, so it is admitted by SHAPE, exactly like `ISO_DATE`:
 * a snake_case identifier of at most 32 characters cannot append a clause or
 * close a frame. Deliberately NOT checked against an imported allow-list —
 * this module is pure and dependency-free by design, and a token outside the
 * schema's vocabulary could not have validated anyway. What matters here is
 * that whatever the input really carries is what the owner reads.
 */
const TYPE_TOKEN = /^[a-z][a-z0-9_]{0,31}$/;

/** How many action types the sentence names before it summarises the rest. The
 *  actions array has a `.min(1)` and no maximum, so a 200-action rule would
 *  otherwise be silently cut by the 500-character clamp — which is the exact
 *  "the card conceals what it does" failure this branch exists to fix. */
const MAX_LISTED_ACTIONS = 6;

function typeToken(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const type = (value as { type?: unknown }).type;
  if (typeof type !== "string") return undefined;
  return TYPE_TOKEN.test(type) ? type : undefined;
}

/** The action types a rule would run, in order, or `undefined` when the input
 *  does not carry a describable action list at all. */
function actionTypes(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const types = value.map(typeToken);
  // ALL or nothing: an unreadable entry means the sentence cannot faithfully
  // say what the rule does, and listing the readable ones would understate it.
  return types.every((t): t is string => t !== undefined) ? types : undefined;
}

function actionsPhrase(types: string[]): string {
  if (types.length <= MAX_LISTED_ACTIONS) return types.join(", ");
  const shown = types.slice(0, MAX_LISTED_ACTIONS).join(", ");
  return `${shown} and ${types.length - MAX_LISTED_ACTIONS} more`;
}

/**
 * The egress destinations of any `call_webhook` action in the rule.
 *
 * The agent tool no longer offers `call_webhook` at all
 * (`AGENT_FORBIDDEN_AUTOMATION_ACTIONS`), so this is unreachable from an agent
 * run today. It is here because this function must never be the reason a
 * webhook is invisible: a proposal row outlives the schema that produced it,
 * and a stored row from before that narrowing — or from a future tool that
 * re-admits the action — must still be DESCRIBED, never silently omitted.
 * The url is model-chosen, so it is quoted like every other such value.
 */
function webhookTargets(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const urls: string[] = [];
  for (const action of value) {
    if (typeToken(action) !== "call_webhook") continue;
    const url = str(action as Record<string, unknown>, "url");
    urls.push(url ? quoted(url) : "an unnamed address");
  }
  return urls;
}

function str(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  if (typeof v !== "string") return undefined;
  const cleaned = stripQuotes(oneLine(v));
  return cleaned.length > 0 ? cleaned : undefined;
}

function count(input: Record<string, unknown>, key: string): number {
  const v = input[key];
  return Array.isArray(v) ? v.length : 0;
}

function fieldsPhrase(n: number): string {
  return `${n} ${n === 1 ? "field" : "fields"}`;
}

/**
 * Human size for the bytes this call would actually write. Local rather than
 * shared: the only sibling (`AiDashboardWizard`'s `formatPayloadSize`) is a
 * private function inside a client component, and exporting it from there would
 * drag a `"use client"` module into the run path.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Number(kb.toFixed(1))} KB`;
  return `${Number((kb / 1024).toFixed(1))} MB`;
}

/** UTF-8 byte length, the unit the attachment row records. `TextEncoder` rather
 *  than `Buffer` so this module stays runtime-agnostic. */
function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Decoded size of a base64 body, without decoding it. */
function base64Bytes(encoded: string): number {
  const cleaned = encoded.trim();
  const padding = cleaned.endsWith("==") ? 2 : cleaned.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((cleaned.length * 3) / 4) - padding);
}

function duration(secs: number): string {
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${secs}s`;
}

/** Which side of `log_time_allocation`'s exclusive-or the call chose. */
function timeTarget(input: Record<string, unknown>): string | undefined {
  const category = str(input, "category");
  if (category) return quoted(category);
  return str(input, "itemId") ? "an item" : undefined;
}

/** One sentence per tool, or undefined when the input does not carry what the
 *  sentence needs (which the caller renders as the `Run <tool>.` fallback). */
function sentenceFor(
  toolName: string,
  input: Record<string, unknown>,
): string | undefined {
  switch (toolName) {
    case "create_item": {
      const name = str(input, "name");
      if (!name) return undefined;
      const fields = count(input, "fields");
      return fields > 0
        ? `Add "${name}" to a board group, setting ${fieldsPhrase(fields)}.`
        : `Add "${name}" to a board group.`;
    }

    case "update_item": {
      const name = str(input, "name");
      const fields = count(input, "fields");
      if (name && fields > 0)
        return `Rename an item to "${name}" and set ${fieldsPhrase(fields)}.`;
      if (name) return `Rename an item to "${name}".`;
      if (fields > 0) return `Set ${fieldsPhrase(fields)} on an item.`;
      // A well-formed update that changes nothing. Still worth a sentence: the
      // owner should see that approving it does nothing rather than wonder.
      return str(input, "itemId") ? "Update an item." : undefined;
    }

    case "attach_file": {
      const fileName = str(input, "fileName");
      if (!fileName) return undefined;
      const inline = str(input, "contentBase64");
      // Only the inline form carries the bytes. A `storagePath` attach reads its
      // size from storage at execution time, so stating one here would be a
      // guess presented as a fact.
      return inline
        ? `Attach ${quoted(fileName)} (${formatBytes(base64Bytes(inline))}) to an item.`
        : `Attach ${quoted(fileName)} to an item.`;
    }

    case "create_file": {
      const fileName = str(input, "fileName");
      const format = str(input, "format");
      const content = typeof input.content === "string" ? input.content : null;
      if (!fileName || !format || content === null) return undefined;
      if (!FILE_EXTENSION.test(format)) return undefined;
      // Mirrors create-file.ts: the tool appends the format's extension unless
      // the model already supplied it. The summary must name the file that will
      // exist, not the one the model typed.
      const ext = `.${format}`;
      const named = fileName.toLowerCase().endsWith(ext)
        ? fileName
        : `${fileName}${ext}`;
      return `Attach ${quoted(named)} (${formatBytes(utf8Bytes(content))}) to an item.`;
    }

    case "log_time_allocation": {
      const date = str(input, "date");
      const target = timeTarget(input);
      const secs = typeof input.secs === "number" ? input.secs : null;
      if (!date || !target || secs === null) return undefined;
      if (!ISO_DATE.test(date)) return undefined;
      // `secs: 0` CLEARS the entry (the handler upserts), so "Log 0s" would
      // describe the opposite of the effect.
      return secs === 0
        ? `Clear the logged time against ${target} on ${date}.`
        : `Log ${duration(secs)} against ${target} on ${date}.`;
    }

    // The one proposal whose effect OUTLIVES the approval: a rule fires for
    // everyone on the board, on every matching change, from now on. A card that
    // said only `Create the automation "X" on a board.` told the owner nothing
    // about what they were signing off — which is the whole job of this module.
    case "create_automation": {
      const name = str(input, "name");
      const opening = name
        ? `Create the automation ${quoted(name)} on a board`
        : "Create an automation on a board";
      const trigger = typeToken(input.trigger);
      const actions = actionTypes(input.actions);
      // Degrade to the shape-only sentence rather than describe a rule this
      // function could not read. Naming a trigger it is guessing at would be
      // worse than naming none.
      if (!trigger || !actions) return `${opening}.`;
      const egress = webhookTargets(input.actions);
      const sends =
        egress.length > 0
          ? ` It sends board and item data to ${egress.join(", ")}.`
          : "";
      return `${opening}: on ${trigger}, run ${actionsPhrase(actions)}.${sends}`;
    }

    default:
      return undefined;
  }
}

/**
 * Describe, in at most 500 characters, what approving this proposal would do.
 *
 * `toolName` may be any string — a proposal row outlives the tool that produced
 * it, and a renamed or removed tool must still render a card the owner can
 * decline.
 */
export function summariseProposal(
  toolName: string,
  input: Record<string, unknown>,
): string {
  let sentence: string | undefined;
  try {
    sentence = sentenceFor(toolName, input ?? {});
  } catch {
    // Defence in depth: see NEVER THROWS above.
    sentence = undefined;
  }
  // The fallback is the last unquoted interpolation in this module. A proposal's
  // `tool_name` can only ever be a real descriptor name — the grant gate fails
  // closed on anything else and records no proposal — but this function is pure
  // and callable with anything, so the name is reduced to the characters a tool
  // name is made of rather than trusted.
  const safeToolName = oneLine(toolName).replace(/[^A-Za-z0-9_-]/g, "");
  const text = sentence ?? `Run ${safeToolName || "an unnamed tool"}.`;
  return text.length > PROPOSAL_SUMMARY_MAX_LENGTH
    ? `${text.slice(0, PROPOSAL_SUMMARY_MAX_LENGTH - 1)}…`
    : text;
}
