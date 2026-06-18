import { ChangelogItemBadge } from "./changelog-item-badge";
import { formatDate } from "@/lib/changelog/entries";
import type { ChangelogGroup } from "@/lib/changelog/entries";

export function ChangelogDateGroup({ group }: { group: ChangelogGroup }) {
  return (
    <section className="relative pl-6">
      <span
        className="bg-primary absolute top-1.5 left-0 size-2 -translate-x-1/2 rounded-full"
        aria-hidden
      />
      <h2 className="text-muted-foreground mb-4 text-sm font-medium">
        {formatDate(group.date)}
      </h2>
      <ul className="space-y-3">
        {group.entries.map((entry, i) => (
          <li key={i} className="bg-surface rounded-md border p-4">
            <div className="mb-1.5 flex items-center gap-2">
              <ChangelogItemBadge kind={entry.kind} />
              <h3 className="text-sm font-semibold">{entry.title}</h3>
            </div>
            {entry.description ? (
              <p className="text-muted-foreground text-sm text-pretty">
                {entry.description}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
