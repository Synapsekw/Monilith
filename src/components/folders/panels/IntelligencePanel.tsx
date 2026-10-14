import type { IntelligenceBrief } from "@/lib/folders/types";
import { Panel } from "./Panel";

/** Only rendered by `Overview.tsx` when `briefs.length > 0` — an empty list
 *  means "no board has a run", which stays invisible, not an empty panel. */
export function IntelligencePanel({
  kicker,
  title = "Intelligence",
  briefs,
}: {
  kicker: string;
  title?: string;
  briefs: IntelligenceBrief[];
}) {
  return (
    <Panel kicker={kicker} title={title}>
      <ul className="flex flex-col gap-3">
        {briefs.map((b) => (
          <li key={b.boardId} className="text-xs">
            <p className="font-medium">{b.boardName}</p>
            <p className="text-muted-foreground">{b.brief}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
