import { createHash } from "node:crypto";

/**
 * The per-item composite document that gets embedded (spec §4.4 + §11 res. #4):
 *   name + text-cell values + recent comment text + status/dropdown LABELS.
 * Labels only — never ids (privacy parity with E4). No raw attachment bodies.
 *
 * v1 embeds ONE composite document per item, not every field independently, so
 * "onboarding" can match "New-hire checklist" with zero shared words.
 */
export type ItemDocumentParts = {
  name: string;
  textCells?: string[];
  comments?: string[];
  /** Resolved status/dropdown option LABELS (never option ids). */
  statusLabels?: string[];
};

// Caps bound both the embedding cost and the model's input window. Comments are
// the unbounded surface (an item can accrue many), so we keep the most recent.
const MAX_COMMENTS = 10;
const MAX_PART_CHARS = 2_000;
const MAX_DOC_CHARS = 8_000;

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_PART_CHARS);
}

function section(values: readonly string[] | undefined): string[] {
  if (!values) return [];
  return values.map(clean).filter((v) => v.length > 0);
}

/**
 * Serialize an item's embeddable parts into a single deterministic document.
 * Deterministic ordering (name → text cells → comments → labels) so the same
 * inputs always hash the same (contentHash bounds re-embedding).
 */
export function buildItemDocument(parts: ItemDocumentParts): string {
  const lines: string[] = [];

  const name = clean(parts.name);
  if (name.length > 0) lines.push(name);

  lines.push(...section(parts.textCells));
  lines.push(...section(parts.comments).slice(-MAX_COMMENTS));
  lines.push(...section(parts.statusLabels));

  return lines.join("\n").slice(0, MAX_DOC_CHARS);
}

/**
 * Stable content hash of a built document. Same input → same hash (skip
 * re-embedding); any change → different hash. Paired with item_embeddings.model
 * so a model swap re-embeds even when the document text is unchanged.
 */
export function contentHash(document: string): string {
  return createHash("sha256").update(document).digest("hex");
}
