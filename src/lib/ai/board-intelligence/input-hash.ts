import { createHash } from "node:crypto";

/** Spec §4.5: hash of item count, max updated_at across items, and the signal
 *  counts. Same input → same hash → the cached run is served without a model call. */
export function intelligenceInputHash(input: {
  itemCount: number;
  maxUpdatedAt: string | null;
  signals: readonly { kind: string; count: number }[];
}): string {
  const sig = [...input.signals]
    .sort((a, b) => a.kind.localeCompare(b.kind))
    .map((s) => `${s.kind}=${s.count}`)
    .join(",");
  return createHash("sha256")
    .update(`${input.itemCount}|${input.maxUpdatedAt ?? ""}|${sig}`)
    .digest("hex");
}
