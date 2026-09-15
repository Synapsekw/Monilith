import { band } from "@/lib/folders/rollup";
import { StatusPill, type StatusColor } from "@/components/ui/status-pill";

const BAND_COLOR: Record<ReturnType<typeof band>, StatusColor> = {
  green: "green",
  blue: "blue",
  yellow: "yellow",
  gray: "gray",
};

/** % done per (board, stage) as soft badges (spec §5.3.3). Wide → scrolls in its own container. */
export function StageMatrix({
  boards,
  stages,
  cells,
  onSelectStage,
}: {
  boards: { id: string; name: string }[];
  stages: { key: string; name: string }[];
  cells: Map<string, Map<string, number | null>>;
  onSelectStage?: (key: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b">
            <th className="text-muted-foreground py-2 pr-3 text-left font-medium">
              Board
            </th>
            {stages.map((s) => (
              <th key={s.key} className="py-2 pr-3 text-left">
                {onSelectStage ? (
                  <button
                    type="button"
                    onClick={() => onSelectStage(s.key)}
                    // Hand-rolled control: it has to buy its own 44px coarse
                    // touch target, the app primitives get it for free.
                    className="focus-visible:ring-ring hover:text-foreground text-muted-foreground inline-flex items-center rounded-sm font-medium focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-11 pointer-coarse:px-3"
                  >
                    {s.name}
                  </button>
                ) : (
                  <span className="text-muted-foreground font-medium">
                    {s.name}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {boards.map((b) => (
            <tr key={b.id} className="border-b last:border-b-0">
              <td className="py-2 pr-3 font-medium">{b.name}</td>
              {stages.map((s) => {
                const v = cells.get(b.id)?.get(s.key) ?? null;
                return (
                  <td key={s.key} className="py-2 pr-3">
                    {v === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <StatusPill
                        color={BAND_COLOR[band(v)]}
                        variant="soft"
                        data-band={band(v)}
                      >
                        {v}%
                      </StatusPill>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
