import {
  DetectedColumn,
  SynthOption,
  ImportableKind,
  GROUP_HEADER,
  NAME_HEADER,
  SUBTASK_MARKER,
} from "./types";
import { nextOptionColor } from "@/lib/boards/option-colors";

/** Detect a kind + synthesized options for every NON-structural column (all columns
 *  except a leading `Group` and the `Name` column). Indexed to align with header. */
export function detectColumns(
  header: string[],
  rows: string[][],
): DetectedColumn[] {
  const { dataHeaders, dataColIndices } = resolveStructure(header);

  return dataHeaders.map((h, di) => {
    const colIdx = dataColIndices[di];
    // Collect up to 50 non-empty values
    const sampleValues: string[] = [];
    for (const row of rows) {
      if (sampleValues.length >= 50) break;
      const val = (row[colIdx] ?? "").trim();
      if (val !== "") sampleValues.push(val);
    }

    const kind = inferKind(sampleValues);
    const options = kind === "status" ? synthesizeOptions(sampleValues) : [];

    return { header: h, kind, options, sampleValues };
  });
}

export type SplitRows = {
  groups: string[]; // distinct group names, in first-seen order
  items: { group: string; name: string; cells: string[] }[]; // top-level, cells aligned to data columns
  subitems: { parentIndex: number; name: string; cells: string[] }[]; // parentIndex → items[]
  dataHeaders: string[]; // header minus Group & Name, in order
};

/** Resolve structural columns + subtask nesting from row order. */
export function splitRows(header: string[], rows: string[][]): SplitRows {
  const { groupColIdx, nameColIdx, dataHeaders, dataColIndices } =
    resolveStructure(header);

  const hasGroup = groupColIdx !== -1;

  const groups: string[] = [];
  const items: { group: string; name: string; cells: string[] }[] = [];
  const subitems: { parentIndex: number; name: string; cells: string[] }[] = [];

  // Track last top-level item index per group for subtask attachment
  const lastItemIndexByGroup = new Map<string, number>();

  for (const row of rows) {
    const group = hasGroup
      ? (row[groupColIdx] ?? "").trim() || "Imported"
      : "Imported";

    const rawName = (row[nameColIdx] ?? "").trim();
    const cells = dataColIndices.map((ci) => row[ci] ?? "");

    const isSubtask = rawName.startsWith(SUBTASK_MARKER);

    if (isSubtask) {
      const name = rawName.slice(SUBTASK_MARKER.length);
      const parentIdx = lastItemIndexByGroup.get(group);

      if (parentIdx !== undefined) {
        subitems.push({ parentIndex: parentIdx, name, cells });
      } else {
        // No preceding parent in same group — promote to top-level
        if (!groups.includes(group)) groups.push(group);
        const itemIdx = items.length;
        items.push({ group, name, cells });
        lastItemIndexByGroup.set(group, itemIdx);
      }
    } else {
      if (!groups.includes(group)) groups.push(group);
      const itemIdx = items.length;
      items.push({ group, name: rawName, cells });
      lastItemIndexByGroup.set(group, itemIdx);
    }
  }

  return { groups, items, subitems, dataHeaders };
}

// ─── Internal helpers ──────────────────────────────────────────────────────

type StructureInfo = {
  groupColIdx: number; // -1 if absent
  nameColIdx: number;
  dataHeaders: string[];
  dataColIndices: number[];
};

function resolveStructure(header: string[]): StructureInfo {
  const groupColIdx = header.findIndex(
    (h) => h.trim().toLowerCase() === GROUP_HEADER.toLowerCase(),
  );
  let nameColIdx = header.findIndex(
    (h) => h.trim().toLowerCase() === NAME_HEADER.toLowerCase(),
  );

  // Fallback: first non-Group column is the name
  if (nameColIdx === -1) {
    nameColIdx = header.findIndex((_, i) => i !== groupColIdx);
  }

  const dataHeaders: string[] = [];
  const dataColIndices: number[] = [];

  header.forEach((h, i) => {
    if (i === groupColIdx || i === nameColIdx) return;
    dataHeaders.push(h);
    dataColIndices.push(i);
  });

  return { groupColIdx, nameColIdx, dataHeaders, dataColIndices };
}

const CHECKBOX_VALUES = new Set([
  "true",
  "false",
  "yes",
  "no",
  "1",
  "0",
  "✓",
  "x",
]);

function inferKind(samples: string[]): ImportableKind {
  if (samples.length === 0) return "text";

  // All parse as finite numbers?
  if (samples.every((v) => isFiniteNumber(v))) return "numbers";

  // All are checkbox-like?
  if (samples.every((v) => CHECKBOX_VALUES.has(v.toLowerCase())))
    return "checkbox";

  // All match ISO date or parse ok?
  if (samples.every((v) => isDateLike(v))) return "date";

  // Distinct non-empty count ≤ 12 AND ≤ half the sampled count → status
  const distinct = new Set(samples.map((v) => v.trim())).size;
  if (distinct <= 12 && distinct <= Math.ceil(samples.length / 2))
    return "status";

  return "text";
}

function isFiniteNumber(v: string): boolean {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n);
}

function isDateLike(v: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return true;
  const d = Date.parse(v);
  return !Number.isNaN(d);
}

function synthesizeOptions(samples: string[]): SynthOption[] {
  const seen = new Set<string>();
  const options: SynthOption[] = [];
  const usedColors: string[] = [];

  for (const v of samples) {
    const label = v.trim();
    if (label === "" || seen.has(label)) continue;
    seen.add(label);
    const color = nextOptionColor(usedColors);
    usedColors.push(color);
    options.push({ id: crypto.randomUUID(), label, color });
  }

  return options;
}
