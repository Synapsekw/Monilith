import Form from "next/form";
import { searchUsers } from "@/lib/platform/queries";
import { Pager } from "@/components/platform/pager";
import { UserRowActions } from "@/components/admin/user-row-actions";

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

      {users.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {q ? "No users match that search." : "No users yet."}
        </p>
      ) : (
        <div className="bg-surface overflow-hidden rounded-xl border">
          <div className="text-muted-foreground grid grid-cols-[1.6fr_2fr_0.7fr_120px] gap-3 border-b px-4 py-2.5 text-xs font-medium tracking-wide uppercase">
            <span>Email</span>
            <span>Organizations</span>
            <span>Status</span>
            <span />
          </div>
          {users.map((u) => (
            <div
              key={u.id}
              className="grid grid-cols-[1.6fr_2fr_0.7fr_120px] items-center gap-3 border-b px-4 py-3 text-sm last:border-b-0"
            >
              <span className="text-foreground truncate">{u.email ?? "—"}</span>
              <span className="text-muted-foreground truncate">
                {u.orgNames.length ? u.orgNames.join(" · ") : "—"}
              </span>
              <span
                className={
                  u.bannedUntil ? "text-destructive" : "text-muted-foreground"
                }
              >
                {u.bannedUntil ? "Banned" : "Active"}
              </span>
              <UserRowActions
                userId={u.id}
                email={u.email ?? ""}
                banned={Boolean(u.bannedUntil)}
              />
            </div>
          ))}
        </div>
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
