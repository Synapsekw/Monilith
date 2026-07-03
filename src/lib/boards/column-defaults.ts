import type { ColumnKind } from "@/lib/validations/boards";

const DEFAULT_NAME: Record<ColumnKind, string> = {
  text: "Text",
  status: "Status",
  people: "People",
  date: "Date",
  numbers: "Numbers",
  dropdown: "Dropdown",
  checkbox: "Checkbox",
  rating: "Rating",
  link: "Link",
  email: "Email",
  phone: "Phone",
  files: "Files",
  time_tracking: "Time tracking",
  relation: "Relation",
  mirror: "Mirror",
  percent: "Percent",
  currency: "Currency",
};

function opt(label: string, color: string) {
  return { id: crypto.randomUUID(), label, color };
}

/**
 * Default name + settings for a freshly added column. Status/Dropdown are
 * seeded with usable options (the create_board Status palette) so the column
 * works immediately before the options editor ships. Pure.
 */
export function defaultColumn(
  kind: ColumnKind,
  name?: string,
): { name: string; settings: Record<string, unknown> } {
  const resolved = name?.trim() ? name.trim() : DEFAULT_NAME[kind];
  let settings: Record<string, unknown> = {};
  if (kind === "status") {
    settings = {
      options: [
        opt("Working on it", "#fdab3d"),
        opt("Stuck", "#e2445c"),
        opt("Done", "#00c875"),
      ],
    };
  } else if (kind === "dropdown") {
    settings = {
      options: [opt("Option 1", "#579bfc"), opt("Option 2", "#a25ddc")],
    };
  } else if (kind === "currency") {
    // Zero-friction add: seed USD; "Change currency" in the column menu is
    // one click away (spec §5.1). Snake_case jsonb key per settings convention.
    settings = { currency: "USD" };
  }
  return { name: resolved, settings };
}
