import Link from "next/link";
import type { LoadGrid } from "@/lib/folders/tower";

/** The first column holds its own week and everything older (the RPC folds
 *  older weeks into it), so it is described by the start of the next week. */
function weekWords(grid: LoadGrid, index: number): string {
  const o = index - grid.now;
  if (index === 0 && o < 0)
    return `before ${(grid.weeks[1] ?? grid.weeks[0])?.weekStart ?? ""}`;
  if (o < 0) return o === -1 ? "last week" : `${-o} weeks ago`;
  if (o === 0) return "this week";
  return o === 1 ? "next week" : `in ${o} weeks`;
}

/**
 * Open items by board and week. Past weeks (still open) are tinted with the
 * destructive colour, this week and the weeks ahead with the brand colour;
 * intensity follows the count against the grid's maximum. Every filled cell
 * prints its number and links to the board, so colour is never the only
 * signal. Plain CSS, no chart library. The table scrolls inside its own
 * container at phone width.
 */
export function LoadHeat({ grid }: { grid: LoadGrid }) {
  const max = grid.max || 1;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[26rem] table-fixed border-separate border-spacing-0.5 text-xs">
        <caption className="sr-only">Open items by board and week</caption>
        <thead>
          <tr>
            <th scope="col" className="w-[34%] text-left font-normal">
              <span className="sr-only">Board</span>
            </th>
            {grid.weeks.map((w) => (
              <th
                key={w.weekStart}
                scope="col"
                className="text-kicker text-2xs font-mono font-medium"
              >
                {w.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((r) => (
            <tr key={r.boardId}>
              <th
                scope="row"
                title={r.name}
                className="text-muted-foreground truncate pr-2 text-left font-normal"
              >
                {r.name}
              </th>
              {r.cells.map((n, i) => {
                const week = grid.weeks[i];
                const past = week?.past ?? false;
                const when = weekWords(grid, i);
                if (n === 0) {
                  const none = `${r.name}, ${when}: none open`;
                  return (
                    <td
                      key={i}
                      title={none}
                      className="bg-surface-muted text-muted-foreground h-6 rounded-sm text-center"
                    >
                      <span aria-hidden="true">·</span>
                      <span className="sr-only">{none}</span>
                    </td>
                  );
                }
                const mix = Math.round(14 + 36 * (n / max));
                const verb = past ? "still open" : "due";
                return (
                  <td key={i} className="p-0">
                    <Link
                      href={`/boards/${r.boardId}`}
                      prefetch={false}
                      data-tone={past ? "late" : "ahead"}
                      aria-label={`${r.name}, ${when}: ${n} ${verb}`}
                      title={`${r.name}, ${i === 0 ? when : `week of ${week?.weekStart ?? ""}`}: ${n} ${verb}`}
                      className="text-foreground hover:ring-border-bright focus-visible:ring-ring flex h-6 items-center justify-center rounded-sm font-mono tabular-nums outline-none hover:ring-1 focus-visible:ring-2 pointer-coarse:min-h-11"
                      style={{
                        backgroundColor: `color-mix(in oklab, var(${past ? "--status-red" : "--primary"}) ${mix}%, transparent)`,
                      }}
                    >
                      {n}
                    </Link>
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
