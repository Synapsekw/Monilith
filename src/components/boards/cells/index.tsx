import { Check, Star } from "lucide-react";
import type { ColumnOption } from "@/lib/validations/boards";
import { isHttpUrl } from "@/lib/validations/boards";
import { pillTextColor } from "@/lib/boards/contrast";
import type { EditorMember } from "./editors";

type Settings = Record<string, unknown> & { options?: ColumnOption[] };

export function TextCell({
  value,
}: {
  value: { text: string } | null;
  settings: Settings;
}) {
  return <span className="truncate text-sm">{value?.text ?? ""}</span>;
}

function optionById(settings: Settings, id: string | null) {
  if (!id) return undefined;
  return settings.options?.find((o) => o.id === id);
}

/** Status/label pill — the one sanctioned place for option color. */
function OptionPill({ option }: { option: ColumnOption }) {
  return (
    <span
      className="inline-flex max-w-full items-center truncate rounded-md px-2.5 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: option.color,
        color: pillTextColor(option.color),
      }}
    >
      {option.label}
    </span>
  );
}

export function StatusCell({
  value,
  settings,
}: {
  value: { optionId: string | null } | null;
  settings: Settings;
}) {
  const opt = optionById(settings, value?.optionId ?? null);
  if (!opt) return <span className="text-sm" />;
  return <OptionPill option={opt} />;
}

export function DropdownCell({
  value,
  settings,
}: {
  value: { optionIds: string[] } | null;
  settings: Settings;
}) {
  const opts = (value?.optionIds ?? [])
    .map((id) => optionById(settings, id))
    .filter((o): o is ColumnOption => Boolean(o));
  return (
    <span className="flex flex-wrap gap-1">
      {opts.map((o) => (
        <OptionPill key={o.id} option={o} />
      ))}
    </span>
  );
}

function memberLabel(member: EditorMember | undefined) {
  return member?.fullName || member?.email || "Unknown";
}

export function PeopleCell({
  value,
  members = [],
}: {
  value: { userIds: string[] } | null;
  settings: Settings;
  members?: EditorMember[];
}) {
  const userIds = value?.userIds ?? [];
  if (userIds.length === 0) return <span className="text-sm" />;
  // Without a member directory to resolve ids → names (e.g. mirrored people
  // cells), fall back to the count so we never render a row of "Unknown".
  if (members.length === 0) {
    return (
      <span className="text-muted-foreground text-sm">
        {userIds.length} {userIds.length === 1 ? "person" : "people"}
      </span>
    );
  }
  const byId = new Map(members.map((m) => [m.userId, m]));
  const names = userIds.map((id) => memberLabel(byId.get(id)));
  return <span className="truncate text-sm">{names.join(", ")}</span>;
}

export function DateCell({
  value,
}: {
  value: { date: string; end?: string } | null;
  settings: Settings;
}) {
  if (!value?.date) return <span className="text-sm" />;
  const formatted = new Date(value.date).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return <span className="text-sm">{formatted}</span>;
}

export function NumberCell({
  value,
  settings,
}: {
  value: { n: number } | null;
  settings: Settings & { unit?: string; precision?: number };
}) {
  if (value == null) return <span className="text-sm" />;
  const n =
    typeof settings.precision === "number"
      ? value.n.toFixed(settings.precision)
      : String(value.n);
  return (
    <span className="text-sm tabular-nums">
      {n}
      {settings.unit ? ` ${settings.unit}` : ""}
    </span>
  );
}

export function CheckboxCell({
  value,
}: {
  value: { checked: boolean } | null;
  settings: Settings;
}) {
  const checked = value?.checked ?? false;
  return (
    <span
      aria-label={checked ? "checked" : "unchecked"}
      className="flex items-center"
    >
      <span
        className={`flex size-4 items-center justify-center rounded border ${checked ? "bg-primary border-primary" : "border-muted-foreground/40"}`}
      >
        {checked && <Check className="text-primary-foreground size-3" />}
      </span>
    </span>
  );
}

/**
 * Shared progress/fill bar for the percent column — used by both the leaf cell
 * (PercentCell) and the collapsed-parent rollup (RollupCell), so a manually-set
 * value and an averaged rollup read identically. Monochrome track; the brand
 * accent (`bg-primary`) earns the fill. `muted` dims it for the rollup variant.
 * The numeric label carries the value (never color alone — AA + colorblind).
 */
export function PercentBar({
  percent,
  muted = false,
}: {
  percent: number;
  muted?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <span className="flex w-full items-center gap-2">
      <span
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${clamped}%`}
        className="bg-muted relative h-1.5 w-full max-w-[120px] min-w-[2.5rem] overflow-hidden rounded-full"
      >
        <span
          className={`absolute inset-y-0 left-0 rounded-full ${muted ? "bg-muted-foreground/50" : "bg-primary"}`}
          style={{ width: `${clamped}%` }}
        />
      </span>
      <span className="text-muted-foreground text-xs tabular-nums">
        {clamped}%
      </span>
    </span>
  );
}

export function PercentCell({
  value,
}: {
  value: { percent: number } | null;
  settings: Settings;
}) {
  if (value == null || typeof value.percent !== "number")
    return <span className="text-sm" />;
  return <PercentBar percent={value.percent} />;
}

export function RatingCell({
  value,
}: {
  value: { rating: number } | null;
  settings: Settings;
}) {
  const r = value?.rating ?? 0;
  return (
    <span aria-label={`${r} of 5`} className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`size-3.5 ${i <= r ? "fill-current text-amber-400" : "text-muted-foreground/30"}`}
        />
      ))}
    </span>
  );
}

export function LinkCell({
  value,
}: {
  value: { url: string; text?: string } | null;
  settings: Settings;
}) {
  if (!value?.url) return <span className="text-sm" />;
  // Defense-in-depth: never render a non-http(s) href (e.g. a `javascript:` URL
  // that slipped past an older boundary) as a clickable anchor.
  if (!isHttpUrl(value.url))
    return <span className="truncate text-sm">{value.text || value.url}</span>;
  return (
    <a
      href={value.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="text-primary truncate text-sm underline-offset-2 hover:underline"
    >
      {value.text || value.url}
    </a>
  );
}

export function EmailCell({
  value,
}: {
  value: { email: string } | null;
  settings: Settings;
}) {
  if (!value?.email) return <span className="text-sm" />;
  return (
    <a
      href={`mailto:${value.email}`}
      onClick={(e) => e.stopPropagation()}
      className="text-primary truncate text-sm hover:underline"
    >
      {value.email}
    </a>
  );
}

export function PhoneCell({
  value,
}: {
  value: { phone: string } | null;
  settings: Settings;
}) {
  if (!value?.phone) return <span className="text-sm" />;
  return (
    <a
      href={`tel:${value.phone}`}
      onClick={(e) => e.stopPropagation()}
      className="text-primary truncate text-sm hover:underline"
    >
      {value.phone}
    </a>
  );
}

/** Dispatch a cell to its kind's renderer. Read-only in 2a. */
export function CellRenderer({
  kind,
  value,
  settings,
  members,
}: {
  kind: string;
  value: unknown;
  settings: Settings;
  members?: EditorMember[];
}) {
  switch (kind) {
    case "text":
      return (
        <TextCell
          value={value as { text: string } | null}
          settings={settings}
        />
      );
    case "status":
      return (
        <StatusCell
          value={value as { optionId: string | null } | null}
          settings={settings}
        />
      );
    case "dropdown":
      return (
        <DropdownCell
          value={value as { optionIds: string[] } | null}
          settings={settings}
        />
      );
    case "people":
      return (
        <PeopleCell
          value={value as { userIds: string[] } | null}
          settings={settings}
          members={members}
        />
      );
    case "date":
      return (
        <DateCell
          value={value as { date: string; end?: string } | null}
          settings={settings}
        />
      );
    case "numbers":
      return (
        <NumberCell value={value as { n: number } | null} settings={settings} />
      );
    case "checkbox":
      return (
        <CheckboxCell
          value={value as { checked: boolean } | null}
          settings={settings}
        />
      );
    case "rating":
      return (
        <RatingCell
          value={value as { rating: number } | null}
          settings={settings}
        />
      );
    case "percent":
      return (
        <PercentCell
          value={value as { percent: number } | null}
          settings={settings}
        />
      );
    case "link":
      return (
        <LinkCell
          value={value as { url: string; text?: string } | null}
          settings={settings}
        />
      );
    case "email":
      return (
        <EmailCell
          value={value as { email: string } | null}
          settings={settings}
        />
      );
    case "phone":
      return (
        <PhoneCell
          value={value as { phone: string } | null}
          settings={settings}
        />
      );
    // Files cells are special-cased in BoardTable's EditableCell (they need the
    // board cache + upload/lightbox wiring), not rendered through this switch.
    case "files":
      return null;
    // Time-tracking cells are special-cased in BoardTable's EditableCell (they
    // need the board cache + timer callbacks), not rendered through this switch.
    case "time_tracking":
      return null;
    default:
      return null;
  }
}
