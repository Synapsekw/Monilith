import type { BoardOption } from "@/components/dashboards/WidgetConfigForm";
import { optionSchema } from "@/lib/validations/boards";

type ColRow = {
  id: string;
  name: string;
  kind: string;
  settings: unknown;
  board_id: string;
};

/** Source-board options for the Add-widget dialog (shared by the dashboard page and the folder strip). */
export function buildBoardOptions(
  boardRows: { id: string; name: string }[],
  allCols: ColRow[],
): BoardOption[] {
  return boardRows.map((b) => {
    const cols = allCols.filter((c) => c.board_id === b.id);
    const pick = (kind: string) =>
      cols
        .filter((c) => c.kind === kind)
        .map((c) => ({ id: c.id, name: c.name }));
    return {
      id: b.id,
      name: b.name,
      numbersColumns: pick("numbers"),
      statusColumns: pick("status"),
      dateColumns: pick("date"),
      peopleColumns: pick("people"),
      dropdownColumns: pick("dropdown"),
      percentColumns: pick("percent"),
      allColumns: cols.map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        options:
          optionSchema
            .array()
            .safeParse((c.settings as { options?: unknown })?.options ?? [])
            .data ?? [],
      })),
    };
  });
}
