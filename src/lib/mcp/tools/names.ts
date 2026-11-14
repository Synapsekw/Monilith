import type { OrgMemberProfile } from "@/lib/mcp/org-scope";

/** user id → display name, for turning people cells into names. */
export function nameMap(profiles: OrgMemberProfile[]): Map<string, string> {
  return new Map(
    profiles.map((p) => [p.userId, p.fullName ?? "Unnamed member"]),
  );
}

export function personName(names: Map<string, string>, id: string): string {
  return names.get(id) ?? "Unknown member";
}

const MAX_VALUE_CHARS = 120;

function optionLabel(settings: unknown, optionId: string): string | null {
  const options = (settings as { options?: unknown } | null)?.options;
  if (!Array.isArray(options)) return null;
  for (const o of options) {
    const opt = o as { id?: unknown; label?: unknown };
    if (opt.id === optionId && typeof opt.label === "string") return opt.label;
  }
  return null;
}

/** One cell value as short plain text an assistant can quote. */
export function describeCellValue(
  kind: string,
  settings: unknown,
  value: unknown,
  names: Map<string, string>,
): string {
  if (value === null || value === undefined) return "(empty)";
  const v = value as Record<string, unknown>;
  if (kind === "status" && typeof v.optionId === "string")
    return optionLabel(settings, v.optionId) ?? "(unknown option)";
  if (kind === "people" && Array.isArray(v.userIds))
    return v.userIds.length === 0
      ? "(nobody)"
      : v.userIds.map((id) => personName(names, String(id))).join(", ");
  if (kind === "date" && typeof v.date === "string")
    return typeof v.end === "string" && v.end
      ? `${v.date} to ${v.end}`
      : v.date;
  const text = typeof v.text === "string" ? v.text : JSON.stringify(value);
  return text.slice(0, MAX_VALUE_CHARS);
}
