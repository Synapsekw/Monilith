import type { ColumnKind } from "@/lib/validations/boards";
import type { ImportableKind, SynthOption } from "./types";

export type BoardColumnRef = {
  id: string;
  name: string;
  kind: ColumnKind;
  options: SynthOption[];
};

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isKindCompatible(
  source: ImportableKind,
  target: ColumnKind,
): boolean {
  return target === "text" || (source as string) === (target as string);
}

export function autoMatchColumns(
  headers: { name: string; kind: ImportableKind }[],
  boardColumns: BoardColumnRef[],
): (string | null)[] {
  const claimed = new Set<string>();
  return headers.map((header) => {
    const normalizedHeader = normalizeName(header.name);
    const match = boardColumns.find(
      (col) =>
        !claimed.has(col.id) &&
        normalizeName(col.name) === normalizedHeader &&
        isKindCompatible(header.kind, col.kind),
    );
    if (!match) return null;
    claimed.add(match.id);
    return match.id;
  });
}

export function missingOptionLabels(
  values: string[],
  kind: ImportableKind,
  target: BoardColumnRef,
): string[] {
  const existing = new Set(
    target.options.map((option) => option.label.trim().toLowerCase()),
  );
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const value of values) {
    const labels = kind === "dropdown" ? value.split(",") : [value];
    for (const raw of labels) {
      const label = raw.trim();
      if (!label) continue;
      const key = label.toLowerCase();
      if (existing.has(key) || seen.has(key)) continue;
      seen.add(key);
      missing.push(label);
    }
  }
  return missing;
}
