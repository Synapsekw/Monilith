import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  countPendingAccounts,
  getPlatformStats,
  listAllOrgs,
  platformAuditFeed,
} from "@/lib/platform/queries";
import { StatCard } from "@/components/platform/stat-card";
import { ActivityFeed } from "@/components/settings/activity-feed";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Platform admin" };

export default async function AdminOverview() {
  // countPendingAccounts reads with the service client; it runs its own
  // platform-admin check first (as every query here does), in addition to the
  // layout's requirePlatformAdmin().
  const [stats, orgs, audit, waiting] = await Promise.all([
    getPlatformStats(),
    listAllOrgs(0, 5),
    platformAuditFeed(8),
    countPendingAccounts(),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        kicker="Platform"
        title="Platform admin"
        description="Cross-organization oversight for the whole application."
      />

      {waiting > 0 && (
        <Link
          href="/admin/users"
          className="bg-surface hover:border-border-hover focus-visible:ring-ring group flex items-center gap-3 rounded-lg border px-4 py-3 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <span
            aria-hidden
            className="bg-primary size-2 shrink-0 rounded-full"
          />
          <span className="text-foreground font-medium">
            <span className="tabular-nums">{waiting}</span>{" "}
            {waiting === 1 ? "account" : "accounts"} waiting for approval
          </span>
          <span className="text-primary ml-auto flex items-center gap-1 text-xs font-medium">
            Review
            <ChevronRight
              aria-hidden
              className="ease-keystone size-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
            />
          </span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Organizations" value={stats.orgs} />
        <StatCard label="Users" value={stats.users} />
        <StatCard label="Platform admins" value={stats.admins} />
        <StatCard label="Events · 24h" value={stats.events24h} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <section className="bg-surface rounded-lg border p-4">
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

        <section className="bg-surface rounded-lg border p-4">
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
