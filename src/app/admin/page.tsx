import Link from "next/link";
import {
  getPlatformStats,
  listAllOrgs,
  platformAuditFeed,
} from "@/lib/platform/queries";
import { StatCard } from "@/components/platform/stat-card";
import { ActivityFeed } from "@/components/settings/activity-feed";

export const metadata = { title: "Platform admin" };

export default async function AdminOverview() {
  const [stats, orgs, audit] = await Promise.all([
    getPlatformStats(),
    listAllOrgs(0, 5),
    platformAuditFeed(8),
  ]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-foreground font-heading text-2xl font-semibold tracking-tight">
          Platform admin
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Cross-organization oversight for the whole application.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Organizations" value={stats.orgs} />
        <StatCard label="Users" value={stats.users} />
        <StatCard label="Platform admins" value={stats.admins} />
        <StatCard label="Events · 24h" value={stats.events24h} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <section className="bg-surface rounded-xl border p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-foreground text-sm font-medium">
              Recent organizations
            </h2>
            <Link
              href="/admin/organizations"
              className="text-primary text-xs font-medium"
            >
              View all →
            </Link>
          </div>
          {orgs.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No organizations yet.
            </p>
          ) : (
            <ul className="divide-border divide-y text-sm">
              {orgs.map((o) => (
                <li
                  key={o.id}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <span className="text-foreground min-w-0 truncate">
                    {o.name}
                  </span>
                  <Link
                    href={`/admin/organizations/${o.id}`}
                    className="text-primary shrink-0 text-xs font-medium"
                  >
                    Manage →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-surface rounded-xl border p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-foreground text-sm font-medium">
              Recent activity
            </h2>
            <Link
              href="/admin/audit"
              className="text-primary text-xs font-medium"
            >
              View all →
            </Link>
          </div>
          <ActivityFeed rows={audit} />
        </section>
      </div>
    </div>
  );
}
