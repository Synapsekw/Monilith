import { Kicker } from "@/components/ui/kicker";

export function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface rounded-lg border p-4">
      <Kicker className="text-muted-foreground block">{label}</Kicker>
      <div className="text-foreground mt-1.5 text-2xl font-semibold">
        {value.toLocaleString()}
      </div>
    </div>
  );
}
