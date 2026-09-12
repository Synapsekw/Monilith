import { Check, Network, Star } from "lucide-react";
import type { ColumnOption } from "@/lib/validations/boards";
import { isHttpUrl } from "@/lib/validations/boards";
import { effectivePriority } from "@/lib/boards/priority";
import { percentBandColor } from "@/lib/boards/percent-color";
import { stripMarkdown } from "@/lib/boards/markdown";
import { cn } from "@/lib/utils";
import { ColorChip } from "@/components/ui/color-chip";
import { StatusPill, statusToneClasses } from "@/components/ui/status-pill";
import { Kicker } from "@/components/ui/kicker";
import { CurrencyAmount } from "@/components/boards/CurrencyAmount";
import type { EditorMember } from "./editors";
import { MemberAvatar } from "./member-avatar";

type Settings = Record<string, unknown> & { options?: ColumnOption[] };

/**
 * Board cells render at the `text-cell` token (13px, see `--text-cell` in
 * globals.css) — the Quiet Grid data scale (see the spec at
 * docs/superpowers/specs/2026-09-12-quiet-grid-inter-design.md). This is one
 * step below `text-sm`, which is the app-wide default everywhere else; the
 * table is denser than the rest of the product on purpose. A named rem-based
 * token, not an arbitrary pixel value, because `scripts/check-px-text.mjs`
 * bans those repo-wide — rem tokens respond to the reader's browser
 * font-size setting.
 */

/**
 * Collapsed text cell. Text columns hold Markdown (see LongTextEditor), so the
 * resting view strips the syntax and flattens to one line — this renderer also
 * backs Mirror and Rollup cells.
 */
export function TextCell({
  value,
}: {
  value: { text: string } | null;
  settings: Settings;
}) {
  const text = stripMarkdown(value?.text ?? "");
  return (
    <span className="text-cell truncate" title={text || undefined}>
      {text}
    </span>
  );
}

function optionById(settings: Settings, id: string | null) {
  if (!id) return undefined;
  return settings.options?.find((o) => o.id === id);
}

/**
 * Status/label pill — delegates to the shared {@link ColorChip}, the one
 * sanctioned rendering of arbitrary option color (translucent tint +
 * contrast-clamped per-theme text). Interactive (the cell is click-to-edit),
 * so it opts into the pill hover motion.
 */
function OptionPill({ option }: { option: ColumnOption }) {
  return (
    <ColorChip
      color={option.color}
      className="hover:-translate-y-px hover:brightness-110"
    >
      {option.label}
    </ColorChip>
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
  if (!opt) return <span className="text-cell" />;
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

/** Beyond this many assignees the stack collapses to 3 avatars + a "+N" disc,
 *  so its width is bounded no matter how many people are on an item. */
const MAX_STACKED_AVATARS = 4;

export function PeopleCell({
  value,
  members = [],
}: {
  value: { userIds: string[] } | null;
  settings: Settings;
  members?: EditorMember[];
}) {
  const userIds = value?.userIds ?? [];
  if (userIds.length === 0) return <span className="text-cell" />;
  // Without a member directory to resolve ids → names (e.g. mirrored people
  // cells), fall back to the count so we never render a row of "Unknown".
  if (members.length === 0) {
    return (
      <span className="text-muted-foreground text-cell">
        {userIds.length} {userIds.length === 1 ? "person" : "people"}
      </span>
    );
  }
  const byId = new Map(members.map((m) => [m.userId, m]));
  // Resolved in the order the ids are stored — never sorted, so the cell reads
  // the same as the editor. Reads from the cached board payload (members):
  // first paint, no fetch, no presence dependency.
  const assignees = userIds.map((id) => {
    const member = byId.get(id);
    return {
      id,
      label: memberLabel(member),
      avatarUrl: member?.avatarUrl ?? null,
    };
  });

  // One assignee: avatar + name, truncating — the column is wide enough.
  if (assignees.length === 1) {
    const only = assignees[0];
    return (
      <span className="text-cell flex items-center gap-1.5 truncate">
        <MemberAvatar
          userId={only.id}
          name={only.label}
          avatarUrl={only.avatarUrl}
        />
        <span className="truncate">{only.label}</span>
      </span>
    );
  }

  // Several assignees: names never fit a 160px column, so collapse to an
  // overlapping avatar stack. Beyond four we show three avatars + "+N" so the
  // stack's width stays fixed; the names live on aria-label/title.
  const visible =
    assignees.length > MAX_STACKED_AVATARS
      ? assignees.slice(0, MAX_STACKED_AVATARS - 1)
      : assignees;
  const overflow = assignees.length - visible.length;
  const names = assignees.map((a) => a.label).join(", ");
  return (
    <span
      className="flex items-center"
      aria-label={`${assignees.length} assigned: ${names}`}
      title={names}
    >
      {visible.map((a) => (
        <MemberAvatar
          key={a.id}
          userId={a.id}
          name={a.label}
          avatarUrl={a.avatarUrl}
          // The ring in the cell's own surface colour keeps the overlapped
          // edges legible; hairlines would read as borders here.
          className="ring-surface -ml-2 ring-2 first:ml-0"
        />
      ))}
      {overflow > 0 ? (
        // The overflow disc stays neutral on purpose: it counts people, it is
        // not one — an identity colour here would read as a ninth member.
        <span className="bg-surface-muted text-muted-foreground text-2xs ring-surface -ml-2 flex size-6 shrink-0 items-center justify-center rounded-full font-mono ring-2">
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}

export function DateCell({
  value,
  overdue = false,
}: {
  value: { date: string; end?: string } | null;
  settings: Settings;
  /** Past-due + incomplete (derived at render time — see @/lib/boards/overdue). */
  overdue?: boolean;
}) {
  if (!value?.date) return <span className="text-cell" />;
  // Pin the locale — `undefined` differs between the Node server (en-US) and a
  // non-US-default browser ("Jan 1" vs "1 Jan") → hydration mismatch. "en-US"
  // matches the rest of the board date formatters.
  const formatted = new Date(value.date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  // Keystone: dates read as mono, uppercase, wide-tracked metadata.
  if (!overdue)
    return <Kicker className="text-muted-foreground">{formatted}</Kicker>;
  // Negative margins cancel the padding so the date text does not shift when
  // the tint appears. aria-label/title carry the state — never color alone.
  return (
    <Kicker
      aria-label="Overdue"
      title="Overdue"
      className={cn(
        statusToneClasses("red", "soft"),
        "-mx-1.5 -my-0.5 rounded-sm px-1.5 py-0.5",
      )}
    >
      {formatted}
    </Kicker>
  );
}

export function NumberCell({
  value,
  settings,
}: {
  value: { n: number } | null;
  settings: Settings & { unit?: string; precision?: number };
}) {
  if (value == null) return <span className="text-cell" />;
  const n =
    typeof settings.precision === "number"
      ? value.n.toFixed(settings.precision)
      : String(value.n);
  return (
    <span className="text-cell tabular-nums">
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
 * value and an averaged rollup read identically. Keystone: a translucent
 * `--foreground` track with the value-based red→green fill ramp
 * (`percentBandColor`) + a mono numeric label (color is redundant with the
 * number — never the sole signal).
 */
export function PercentBar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <span className="flex w-full items-center gap-2">
      <span
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${clamped}%`}
        className="bg-foreground/[0.07] relative h-1.5 w-full max-w-[120px] min-w-[2.5rem] overflow-hidden rounded-full"
      >
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            percentBandColor(clamped),
          )}
          style={{ width: `${clamped}%` }}
        />
      </span>
      <span className="text-muted-foreground font-mono text-xs tabular-nums">
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
    return <span className="text-cell" />;
  return <PercentBar percent={value.percent} />;
}

/**
 * Currency cell — the amount formatted in the column's currency (viewer
 * locale). Monochrome data surface (pulse-ui): no color, tabular numerals.
 */
export function CurrencyCell({
  value,
  settings,
}: {
  value: { amount: number } | null;
  settings: Settings;
}) {
  if (value == null || typeof value.amount !== "number")
    return <span className="text-cell" />;
  return (
    <span className="text-cell truncate tabular-nums">
      <CurrencyAmount amount={value.amount} settings={settings} />
    </span>
  );
}

/**
 * Priority cell — fixed Normal/Critical vocabulary. Critical is the earned
 * red (status token, never raw color); the auto variant (>= 2 dependents,
 * derived render-time — see @/lib/boards/priority) adds a small network icon
 * and a title/aria explanation so "auto" never reads as a stuck manual value.
 */
export function PriorityCell({
  value,
  dependents = 0,
}: {
  value: { level: "normal" | "critical" } | null;
  settings: Settings;
  /** Direct dependents of this item (derived at the row-render site). */
  dependents?: number;
}) {
  const { level, auto } = effectivePriority(value, dependents);
  if (level === "critical") {
    const label = auto
      ? `Critical (auto) — ${dependents} items depend on this`
      : "Critical";
    return (
      <StatusPill
        color="red"
        variant="solid"
        aria-label={label}
        title={label}
        className="gap-1"
      >
        {auto && <Network className="size-3 shrink-0" aria-hidden />}
        Critical
      </StatusPill>
    );
  }
  // Explicit Normal reads as quiet metadata; unset stays blank (no per-row noise).
  if (value?.level === "normal")
    return <span className="text-muted-foreground text-cell">Normal</span>;
  return <span className="text-cell" />;
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
          className={`size-3.5 ${i <= r ? "text-status-yellow fill-current" : "text-muted-foreground/30"}`}
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
  if (!value?.url) return <span className="text-cell" />;
  // Defense-in-depth: never render a non-http(s) href (e.g. a `javascript:` URL
  // that slipped past an older boundary) as a clickable anchor.
  if (!isHttpUrl(value.url))
    return (
      <span className="text-cell truncate">{value.text || value.url}</span>
    );
  return (
    <a
      href={value.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="text-primary text-cell truncate underline-offset-2 hover:underline"
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
  if (!value?.email) return <span className="text-cell" />;
  return (
    <a
      href={`mailto:${value.email}`}
      onClick={(e) => e.stopPropagation()}
      className="text-primary text-cell truncate hover:underline"
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
  if (!value?.phone) return <span className="text-cell" />;
  return (
    <a
      href={`tel:${value.phone}`}
      onClick={(e) => e.stopPropagation()}
      className="text-primary text-cell truncate hover:underline"
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
  overdue,
  dependents,
}: {
  kind: string;
  value: unknown;
  settings: Settings;
  members?: EditorMember[];
  /** Date cells only: past-due + incomplete (see @/lib/boards/overdue). */
  overdue?: boolean;
  /** Priority cells only: direct dependents of the item — see @/lib/boards/priority. */
  dependents?: number;
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
          overdue={overdue}
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
    case "currency":
      return (
        <CurrencyCell
          value={value as { amount: number } | null}
          settings={settings}
        />
      );
    case "priority":
      return (
        <PriorityCell
          value={value as { level: "normal" | "critical" } | null}
          settings={settings}
          dependents={dependents}
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
