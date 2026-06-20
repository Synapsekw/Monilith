export function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface rounded-xl border p-4">
      <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {label}
      </div>
      <div className="text-foreground mt-1.5 text-2xl font-semibold">
        {value.toLocaleString()}
      </div>
    </div>
  );
}
