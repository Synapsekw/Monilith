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

/** Detect a kind + synthesized options for EVERY column including structural ones (Group, Name).
 *  Indexed to align with header. */
export function detectAllColumns(
  header: string[],
  rows: string[][],
): DetectedColumn[] {
  return header.map((h, colIdx) => {
    const sampleValues: string[] = [];
    for (const row of rows) {
      if (sampleValues.length >= 50) break;
      const val = (row[colIdx] ?? "").trim();
      if (val !== "") sampleValues.push(val);
    }
    const kind = inferKind(sampleValues);
    const options =
      kind === "status"
        ? synthesizeOptions(sampleValues)
        : kind === "dropdown"
          ? synthesizeOptions(
              sampleValues.flatMap((v) => v.split(",").map((p) => p.trim())),
            )
          : [];
    return { header: h, kind, options, sampleValues };
  });
}

/** Propose structural column roles (Group and Name indices) from headers. */
export function proposeRoles(header: string[]): {
  nameIndex: number;
  groupIndex: number | null;
} {
  const { groupColIdx, nameColIdx } = resolveStructure(header);
  return {
    nameIndex: nameColIdx,
    groupIndex: groupColIdx === -1 ? null : groupColIdx,
  };
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

const PERCENT_RE = /^-?\d+(?:\.\d+)?\s*%$/;
const CURRENCY_RE = /^[$€£]\s?-?[\d.,]+(?:\.\d+)?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LINK_RE = /^(https?:\/\/|www\.)\S+$/i;

function isDropdownLike(samples: string[]): boolean {
  let anyMulti = false;
  const parts: string[] = [];
  for (const s of samples) {
    const ps = s.split(",").map((p) => p.trim());
    if (ps.some((p) => p === "" || p.length > 30)) return false;
    if (ps.length > 1) anyMulti = true;
    parts.push(...ps);
  }
  const distinct = new Set(parts).size;
  return (
    anyMulti &&
    distinct >= 2 &&
    distinct <= 12 &&
    distinct <= Math.ceil(parts.length / 2)
  );
}

function inferKind(samples: string[]): ImportableKind {
  if (samples.length === 0) return "text";

  // All parse as finite numbers?
  if (samples.every((v) => isFiniteNumber(v))) return "numbers";

  // All are checkbox-like?
  if (samples.every((v) => CHECKBOX_VALUES.has(v.toLowerCase())))
    return "checkbox";

  // All match ISO date or parse ok?
  if (samples.every((v) => isDateLike(v))) return "date";

  // New inference rules: percent, currency, email, link, dropdown
  if (samples.every((v) => PERCENT_RE.test(v))) return "percent";
  if (samples.every((v) => CURRENCY_RE.test(v))) return "currency";
  if (samples.every((v) => EMAIL_RE.test(v))) return "email";
  if (samples.every((v) => LINK_RE.test(v))) return "link";
  if (isDropdownLike(samples)) return "dropdown";

  // 2 ≤ distinct ≤ 12 AND distinct ≤ half the sampled count → status.
  // A single distinct value is a constant (likely free text), not a status,
  // and needing ≥2 distinct labels keeps a one-option "status" from forming.
  const distinct = new Set(samples.map((v) => v.trim())).size;
  if (
    distinct >= 2 &&
    distinct <= 12 &&
    distinct <= Math.ceil(samples.length / 2)
  )
    return "status";

  return "text";
}

function isFiniteNumber(v: string): boolean {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n);
}

// Explicit full year-month-day shapes only. `Date.parse` alone is far too
// permissive ("May 2024", "2024", "3" all parse), so we first require a
// recognised date shape, then confirm it actually parses to a real date.
const DATE_SHAPE_RE =
  /^(\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?|\d{4}\/\d{2}\/\d{2}|\d{2}\/\d{2}\/\d{4})$/;

function isDateLike(v: string): boolean {
  const trimmed = v.trim();
  if (!DATE_SHAPE_RE.test(trimmed)) return false;
  return !Number.isNaN(Date.parse(trimmed));
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
