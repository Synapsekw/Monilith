import { Check, Star } from "lucide-react";
import type { ColumnOption } from "@/lib/validations/boards";
import { isHttpUrl } from "@/lib/validations/boards";
import { pillTextColor } from "@/lib/boards/contrast";

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

export function PeopleCell({
  value,
}: {
  value: { userIds: string[] } | null;
  settings: Settings;
}) {
  const count = value?.userIds.length ?? 0;
  if (count === 0) return <span className="text-sm" />;
  return (
    <span className="text-muted-foreground text-sm">
      {count} {count === 1 ? "person" : "people"}
    </span>
  );
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
}: {
  kind: string;
  value: unknown;
  settings: Settings;
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
    default:
      return null;
  }
}
