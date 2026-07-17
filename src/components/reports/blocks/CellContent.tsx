import type { ReportCell } from "@/lib/reports/shape";
import { softPillText } from "@/components/boards/cells/soft-pill-color";

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/**
 * Render a shaped report cell: a colored pill for option cells that carry a
 * hex (status/dropdown/priority), otherwise plain text. Pure — safe in both the
 * client preview and the server (`renderToStaticMarkup`) render. Pill text uses
 * the app's contrast-safe `softPillText` so arbitrary hues clear AA on white.
 */
export function CellContent({ cell }: { cell: ReportCell | undefined }) {
  if (!cell || !cell.text) return null;
  if (cell.color) {
    const bg = HEX6.test(cell.color) ? `${cell.color}26` : "#eef0f4";
    return (
      <span
        className="r-pill"
        style={{ background: bg, color: softPillText(cell.color).light }}
      >
        {cell.text}
      </span>
    );
  }
  return <>{cell.text}</>;
}
