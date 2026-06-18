import { groupByDate } from "@/lib/changelog/entries";
import type { ChangelogEntry } from "@/lib/changelog/types";
import { ChangelogDateGroup } from "./changelog-date-group";

export function ChangelogTimeline({ entries }: { entries: ChangelogEntry[] }) {
  const groups = groupByDate(entries);

  if (groups.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nothing here yet — check back soon.
      </p>
    );
  }

  return (
    <div className="relative space-y-10 border-l">
      {groups.map((group) => (
        <ChangelogDateGroup key={group.date} group={group} />
      ))}
    </div>
  );
}
