import Link from "next/link";

export function Pager({
  basePath,
  page,
  pageSize,
  total,
  query,
}: {
  basePath: string;
  page: number;
  pageSize: number;
  total: number;
  query?: string;
}) {
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  const qs = (p: number) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (p > 0) params.set("page", String(p));
    const s = params.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  if (total <= pageSize) return null;
  return (
    <div className="text-muted-foreground flex items-center justify-end gap-2 text-sm">
      <span className="mr-2 text-xs">
        Page {page + 1} of {lastPage + 1}
      </span>
      {page > 0 ? (
        <Link href={qs(page - 1)} className="rounded-md border px-3 py-1.5">
          ‹ Prev
        </Link>
      ) : (
        <span className="cursor-not-allowed rounded-md border px-3 py-1.5 opacity-40">
          ‹ Prev
        </span>
      )}
      {page < lastPage ? (
        <Link href={qs(page + 1)} className="rounded-md border px-3 py-1.5">
          Next ›
        </Link>
      ) : (
        <span className="cursor-not-allowed rounded-md border px-3 py-1.5 opacity-40">
          Next ›
        </span>
      )}
    </div>
  );
}
