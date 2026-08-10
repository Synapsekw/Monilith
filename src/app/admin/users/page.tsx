import Form from "next/form";
import { ChevronRight } from "lucide-react";
import { searchUsers } from "@/lib/platform/queries";
import { partitionByAccountKind } from "@/lib/platform/test-accounts";
import { Pager } from "@/components/platform/pager";
import { USER_ROW_GRID, UserRow } from "@/components/admin/user-row";

export const metadata = { title: "Platform admin · users" };
const PAGE_SIZE = 25;

export default async function AdminUsers({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q = "", page: pageStr } = await searchParams;
  const page = Math.max(0, Number(pageStr ?? "0") || 0);
  // No exact count on the user search; fetch one extra row to detect a next page.
  const rows = await searchUsers(q, PAGE_SIZE + 1, page * PAGE_SIZE);
  const hasNext = rows.length > PAGE_SIZE;
  const users = rows.slice(0, PAGE_SIZE);
  // System actors and reserved-domain test accounts are real rows an admin may
  // still need to act on — collapse them, never drop them.
  const { people, systemAndTest } = partitionByAccountKind(users);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-foreground font-heading text-xl font-semibold tracking-tight">
          Users
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Every user across all organizations.
        </p>
      </header>

      <Form action="/admin/users" className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by email…"
          aria-label="Search users by email"
          className="bg-surface focus-visible:ring-ring flex-1 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
        />
        <button
          type="submit"
          className="bg-primary/15 text-primary rounded-md border px-4 py-2 text-sm font-medium"
        >
          Search
        </button>
      </Form>

      {users.length === 0 && (
        <p className="text-muted-foreground text-sm">
          {q ? "No users match that search." : "No users yet."}
        </p>
      )}

      {people.length > 0 && (
        <div className="bg-surface overflow-hidden rounded-xl border">
          <div
            className={`${USER_ROW_GRID} text-muted-foreground border-b px-4 py-2.5 text-xs font-medium tracking-wide uppercase`}
          >
            <span>Email</span>
            <span>Organizations</span>
            <span>Status</span>
            <span />
          </div>
          {people.map((u) => (
            <UserRow key={u.id} user={u} />
          ))}
        </div>
      )}

      {systemAndTest.length > 0 && (
        <details className="bg-surface hover:border-border-hover group overflow-hidden rounded-xl border transition-colors">
          <summary className="focus-visible:ring-ring flex cursor-pointer list-none items-center gap-2 px-4 py-3 marker:content-none focus-visible:ring-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden
              className="text-muted-foreground ease-keystone size-4 shrink-0 transition-transform duration-200 group-open:rotate-90"
            />
            <span className="text-foreground text-sm font-medium">
              System &amp; test accounts
            </span>
            <span className="text-muted-foreground text-sm tabular-nums">
              {systemAndTest.length}
            </span>
            <span className="text-kicker ml-auto hidden text-xs sm:inline">
              Not real customers — the platform agent and seeded test fixtures
            </span>
          </summary>
          <div className="border-t">
            {systemAndTest.map((u) => (
              <UserRow key={u.id} user={u} />
            ))}
          </div>
        </details>
      )}

      <Pager
        basePath="/admin/users"
        page={page}
        pageSize={PAGE_SIZE}
        hasNext={hasNext}
        query={q}
      />
    </div>
  );
}
