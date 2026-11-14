/** `YYYY-MM-DD` → compact `Jul 4`, parsed in UTC so no timezone drift. */
export function formatDue(iso: string): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
