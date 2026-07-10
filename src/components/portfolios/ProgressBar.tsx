export function ProgressBar({ pct }: { pct: number | null }) {
  if (pct === null)
    return <span className="text-muted-foreground text-xs">n/a</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="bg-muted h-1.5 w-20 overflow-hidden rounded-full">
        <div
          className="bg-primary ease-keystone h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-muted-foreground text-xs tabular-nums">{pct}%</span>
    </div>
  );
}
