import Link from "next/link";
import Form from "next/form";
import { listOrgsPage } from "@/lib/platform/queries";
import { Pager } from "@/components/platform/pager";

export const metadata = { title: "Platform admin · organizations" };
const PAGE_SIZE = 25;

export default async function AdminOrganizations({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q = "", page: pageStr } = await searchParams;
  const page = Math.max(0, Number(pageStr ?? "0") || 0);
  const { rows, total } = await listOrgsPage(page, PAGE_SIZE, q);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-foreground font-heading text-xl font-semibold tracking-tight">
          Organizations
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Every organization on the platform.
        </p>
      </header>

      <Form action="/admin/organizations" className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search organizations…"
          aria-label="Search organizations"
          className="bg-surface focus-visible:ring-ring flex-1 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
        />
        <button
          type="submit"
          className="bg-primary/15 text-primary rounded-md border px-4 py-2 text-sm font-medium"
        >
          Search
        </button>
      </Form>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No organizations found.</p>
      ) : (
        <div className="bg-surface overflow-hidden rounded-xl border">
          <div className="text-muted-foreground grid grid-cols-[2fr_1.4fr_1fr_0.8fr_90px] gap-3 border-b px-4 py-2.5 text-xs font-medium tracking-wide uppercase">
            <span>Name</span>
            <span>Slug</span>
            <span>Created</span>
            <span>Members</span>
            <span />
          </div>
          {rows.map((o) => (
            <div
              key={o.id}
              className="grid grid-cols-[2fr_1.4fr_1fr_0.8fr_90px] items-center gap-3 border-b px-4 py-3 text-sm last:border-b-0"
            >
              <span className="text-foreground truncate">{o.name}</span>
              <span className="text-muted-foreground truncate">{o.slug}</span>
              <span className="text-muted-foreground">
                {new Date(o.created_at).toLocaleDateString()}
              </span>
              <span>{o.member_count}</span>
              <Link
                href={`/admin/organizations/${o.id}`}
                className="text-primary text-right text-xs font-medium"
              >
                Manage →
              </Link>
            </div>
          ))}
        </div>
      )}

      <Pager
        basePath="/admin/organizations"
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        query={q}
      />
    </div>
  );
}
