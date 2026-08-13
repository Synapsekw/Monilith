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

function str(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  if (typeof v !== "string") return undefined;
  const cleaned = oneLine(v);
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
  if (category) return `"${category}"`;
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
        ? `Attach ${fileName} (${formatBytes(base64Bytes(inline))}) to an item.`
        : `Attach ${fileName} to an item.`;
    }

    case "create_file": {
      const fileName = str(input, "fileName");
      const format = str(input, "format");
      const content = typeof input.content === "string" ? input.content : null;
      if (!fileName || !format || content === null) return undefined;
      // Mirrors create-file.ts: the tool appends the format's extension unless
      // the model already supplied it. The summary must name the file that will
      // exist, not the one the model typed.
      const ext = `.${format}`;
      const named = fileName.toLowerCase().endsWith(ext)
        ? fileName
        : `${fileName}${ext}`;
      return `Attach ${named} (${formatBytes(utf8Bytes(content))}) to an item.`;
    }

    case "log_time_allocation": {
      const date = str(input, "date");
      const target = timeTarget(input);
      const secs = typeof input.secs === "number" ? input.secs : null;
      if (!date || !target || secs === null) return undefined;
      // `secs: 0` CLEARS the entry (the handler upserts), so "Log 0s" would
      // describe the opposite of the effect.
      return secs === 0
        ? `Clear the logged time against ${target} on ${date}.`
        : `Log ${duration(secs)} against ${target} on ${date}.`;
    }

    case "create_automation": {
      const name = str(input, "name");
      return name
        ? `Create the automation "${name}" on a board.`
        : "Create an automation on a board.";
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
  const text = sentence ?? `Run ${oneLine(toolName) || "an unnamed tool"}.`;
  return text.length > PROPOSAL_SUMMARY_MAX_LENGTH
    ? `${text.slice(0, PROPOSAL_SUMMARY_MAX_LENGTH - 1)}…`
    : text;
}
