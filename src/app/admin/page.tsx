import Link from "next/link";
import { listAllOrgs, platformAuditFeed } from "@/lib/platform/queries";
import { ActivityFeed } from "@/components/settings/activity-feed";
import { UserSearch } from "@/components/admin/user-search";

export const metadata = { title: "Platform admin" };

export default async function AdminHome() {
  // First paint: a bounded org slice + a bounded audit slice (spec §12).
  const [orgs, audit] = await Promise.all([
    listAllOrgs(0),
    platformAuditFeed(50),
  ]);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-foreground font-heading text-2xl font-semibold tracking-tight">
          Platform admin
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Cross-tenant console for platform super-admins.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-foreground text-sm font-medium">Organizations</h2>
        {orgs.length === 0 ? (
          <p className="text-muted-foreground text-sm">No organizations yet.</p>
        ) : (
          <ul className="divide-border bg-surface divide-y rounded-md border text-sm">
            {orgs.map((o) => (
              <li
                key={o.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <div className="text-foreground truncate font-medium">
                    {o.name}
                  </div>
                  <div className="text-muted-foreground truncate text-xs">
                    {o.slug}
                  </div>
                </div>
                <Link
                  href={`/admin/${o.id}`}
                  className="text-primary hover:text-primary/80 focus-visible:ring-ring shrink-0 rounded-md text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  Manage →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-foreground text-sm font-medium">Find a user</h2>
        <UserSearch />
      </section>

      <section className="space-y-3">
        <h2 className="text-foreground text-sm font-medium">
          Recent platform activity
        </h2>
        <ActivityFeed rows={audit} />
      </section>
    </div>
  );
}
