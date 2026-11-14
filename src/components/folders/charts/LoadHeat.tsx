import Link from "next/link";
import type { LoadGrid } from "@/lib/folders/tower";

function weekWords(index: number, total: number): string {
  const back = Math.floor(total / 2);
  const o = index - back;
  if (index === 0) return `${back} weeks ago or earlier`;
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
                className="text-kicker font-mono text-[10px] font-medium"
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
                if (n === 0)
                  return (
                    <td
                      key={i}
                      className="bg-surface-muted text-muted-foreground h-6 rounded-sm text-center"
                    >
                      ·
                    </td>
                  );
                const mix = Math.round(14 + 36 * (n / max));
                const verb = past ? "still open" : "due";
                return (
                  <td key={i} className="p-0">
                    <Link
                      href={`/boards/${r.boardId}`}
                      data-tone={past ? "late" : "ahead"}
                      aria-label={`${r.name}, ${weekWords(i, grid.weeks.length)}: ${n} ${verb}`}
                      title={`${r.name}, week of ${week?.weekStart ?? ""}: ${n} ${verb}`}
                      className="text-foreground hover:ring-border-bright focus-visible:ring-ring flex h-6 items-center justify-center rounded-sm font-mono tabular-nums outline-none hover:ring-1 focus-visible:ring-2"
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
