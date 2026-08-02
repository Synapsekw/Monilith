import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  statusToneClasses,
  type StatusColor,
  type StatusPillColor,
} from "@/components/ui/status-pill";

/**
 * Presentational mock building blocks for the MONOLITH landing page. Pure,
 * server-safe, token-styled (no raw hex, no network). Shared by the static
 * feature sections and the client-side view switcher, so both render the exact
 * same seeded "Q3 launch plan" board data.
 */

/* -------------------------------------------------------------------------- */
/* Seed data                                                                  */
/* -------------------------------------------------------------------------- */

export type Person = {
  initials: string;
  name: string;
  tone: StatusPillColor;
};

export const PEOPLE = {
  dana: { initials: "DK", name: "Dana K.", tone: "primary" },
  marco: { initials: "MP", name: "Marco P.", tone: "teal" },
  theo: { initials: "TL", name: "Theo L.", tone: "yellow" },
  sofia: { initials: "SR", name: "Sofia R.", tone: "purple" },
  nadia: { initials: "NJ", name: "Nadia J.", tone: "orange" },
  elias: { initials: "EV", name: "Elias V.", tone: "green" },
} satisfies Record<string, Person>;

export type BoardRow = {
  task: string;
  owner: Person;
  status: { label: string; color: StatusColor };
  priority: { label: string; color: StatusColor };
  timeline: string;
  progress: number;
};

/** Full board (product-showcase shot). */
export const BOARD_ROWS: BoardRow[] = [
  {
    task: "Q3 launch plan",
    owner: PEOPLE.dana,
    status: { label: "In progress", color: "blue" },
    priority: { label: "High", color: "red" },
    timeline: "Jul 8 to Jul 29",
    progress: 68,
  },
  {
    task: "Onboard new designer",
    owner: PEOPLE.marco,
    status: { label: "Done", color: "green" },
    priority: { label: "Low", color: "gray" },
    timeline: "Jul 1 to Jul 10",
    progress: 100,
  },
  {
    task: "Redesign billing flow",
    owner: PEOPLE.sofia,
    status: { label: "Blocked", color: "red" },
    priority: { label: "Medium", color: "orange" },
    timeline: "Jul 14 to Aug 5",
    progress: 32,
  },
  {
    task: "Ship realtime presence",
    owner: PEOPLE.theo,
    status: { label: "In progress", color: "blue" },
    priority: { label: "High", color: "red" },
    timeline: "Jul 11 to Jul 24",
    progress: 54,
  },
  {
    task: "Customer research calls",
    owner: PEOPLE.nadia,
    status: { label: "In review", color: "purple" },
    priority: { label: "Medium", color: "orange" },
    timeline: "Jul 9 to Jul 22",
    progress: 80,
  },
  {
    task: "Draft Q4 roadmap",
    owner: PEOPLE.elias,
    status: { label: "Not started", color: "gray" },
    priority: { label: "Planned", color: "teal" },
    timeline: "Jul 28 to Aug 18",
    progress: 8,
  },
];

/** Compact 4-row board used inside the live view switcher. */
export const SWITCHER_ROWS: BoardRow[] = [
  BOARD_ROWS[0],
  BOARD_ROWS[3],
  BOARD_ROWS[2],
  BOARD_ROWS[1],
];

/* -------------------------------------------------------------------------- */
/* Atoms                                                                      */
/* -------------------------------------------------------------------------- */

const AVATAR_SIZE = {
  sm: "size-[22px] text-[9px]",
  md: "size-[26px] text-[10px]",
  lg: "size-10 text-sm",
} as const;

export function Avatar({
  person,
  size = "md",
  className,
}: {
  person: Person;
  size?: keyof typeof AVATAR_SIZE;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "inline-flex flex-none items-center justify-center rounded-full font-bold",
        AVATAR_SIZE[size],
        statusToneClasses(person.tone, "solid"),
        className,
      )}
    >
      {person.initials}
    </div>
  );
}

function OwnerCell({ person }: { person: Person }) {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <Avatar person={person} />
      <span className="text-muted-foreground text-[13px]">{person.name}</span>
    </div>
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="flex min-w-[110px] items-center gap-2.5">
      <div className="bg-foreground/10 h-1.5 flex-1 overflow-hidden rounded-full">
        <div
          className="bg-primary h-full rounded-full"
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-muted-foreground w-8 text-right font-mono text-[11px]">
        {value}%
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* App-window frame                                                           */
/* -------------------------------------------------------------------------- */

export function WindowFrame({
  title,
  chip,
  children,
  className,
}: {
  title: string;
  chip?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-surface border-border overflow-hidden rounded-lg border",
        className,
      )}
    >
      <div className="bg-surface-muted border-border flex items-center gap-3.5 border-b px-4 py-3">
        <div className="flex gap-[7px]" aria-hidden="true">
          <i className="bg-foreground/15 block size-[11px] rounded-full" />
          <i className="bg-foreground/15 block size-[11px] rounded-full" />
          <i className="bg-foreground/15 block size-[11px] rounded-full" />
        </div>
        <div className="text-muted-foreground truncate font-mono text-[11px] tracking-[0.08em]">
          {title}
        </div>
        {chip ? (
          <div className="text-kicker border-border ml-auto flex-none rounded-sm border px-2.5 py-1 font-mono text-[10px] tracking-[0.1em]">
            {chip}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Board mock views                                                           */
/* -------------------------------------------------------------------------- */

function Pill({ label, color }: { label: string; color: StatusColor }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
        statusToneClasses(color, "soft"),
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {label}
    </span>
  );
}

export function BoardTableMock({ rows }: { rows: BoardRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-[13.5px]">
        <thead>
          <tr>
            {[
              "Task",
              "Owner",
              "Status",
              "Priority",
              "Timeline",
              "Progress",
            ].map((h) => (
              <th
                key={h}
                className="text-kicker border-border border-b px-4 py-3.5 text-left font-mono text-[10px] font-medium tracking-[0.1em] whitespace-nowrap uppercase"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.task}
              className="border-border/60 hover:bg-foreground/[0.02] border-b transition-colors last:border-0"
            >
              <td className="text-foreground px-4 py-3.5 align-middle font-semibold">
                <span
                  className="bg-primary/85 mr-3 inline-block h-4 w-[3px] -translate-y-px rounded-full align-middle"
                  aria-hidden="true"
                />
                {row.task}
              </td>
              <td className="px-4 py-3.5 align-middle">
                <OwnerCell person={row.owner} />
              </td>
              <td className="px-4 py-3.5 align-middle">
                <Pill label={row.status.label} color={row.status.color} />
              </td>
              <td className="px-4 py-3.5 align-middle">
                <Pill label={row.priority.label} color={row.priority.color} />
              </td>
              <td className="text-muted-foreground px-4 py-3.5 align-middle font-mono text-[11.5px] whitespace-nowrap">
                {row.timeline}
              </td>
              <td className="px-4 py-3.5 align-middle">
                <ProgressBar value={row.progress} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type KanbanColumn = {
  name: string;
  color: StatusColor;
  cards: { task: string; owner: Person; priority: BoardRow["priority"] }[];
};

export const KANBAN_COLUMNS: KanbanColumn[] = [
  {
    name: "In progress",
    color: "blue",
    cards: [
      {
        task: "Q3 launch plan",
        owner: PEOPLE.dana,
        priority: { label: "High", color: "red" },
      },
      {
        task: "Ship realtime presence",
        owner: PEOPLE.theo,
        priority: { label: "High", color: "red" },
      },
    ],
  },
  {
    name: "Blocked",
    color: "red",
    cards: [
      {
        task: "Redesign billing flow",
        owner: PEOPLE.sofia,
        priority: { label: "Medium", color: "orange" },
      },
    ],
  },
  {
    name: "Done",
    color: "green",
    cards: [
      {
        task: "Onboard new designer",
        owner: PEOPLE.marco,
        priority: { label: "Low", color: "gray" },
      },
    ],
  },
];

export function KanbanMock({
  columns,
  className,
}: {
  columns: KanbanColumn[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
    >
      {columns.map((col) => (
        <div
          key={col.name}
          className="bg-surface-muted border-border rounded-lg border p-3.5"
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[13px] font-bold">
              <span
                className={cn(
                  "block size-2 rounded-full",
                  statusToneClasses(col.color, "solid"),
                )}
                aria-hidden="true"
              />
              {col.name}
            </div>
            <span className="text-kicker bg-surface border-border rounded-sm border px-2 py-0.5 font-mono text-[11px]">
              {col.cards.length}
            </span>
          </div>
          <div className="flex flex-col gap-2.5">
            {col.cards.map((card) => (
              <div
                key={card.task}
                className="bg-surface border-border hover:border-border-hover rounded-lg border p-3.5 transition-colors"
              >
                <div className="mb-3 text-[13.5px] leading-snug font-semibold">
                  {card.task}
                </div>
                <div className="flex items-center justify-between">
                  <Pill
                    label={card.priority.label}
                    color={card.priority.color}
                  />
                  <Avatar person={card.owner} size="sm" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

type CalDay = { day: number; event?: { label: string; color: StatusColor } };

const CAL_DAYS: CalDay[] = [
  { day: 7 },
  { day: 8, event: { label: "Q3 launch", color: "blue" } },
  { day: 9, event: { label: "Research", color: "purple" } },
  { day: 10, event: { label: "Onboard done", color: "green" } },
  { day: 11, event: { label: "Presence", color: "blue" } },
  { day: 12 },
  { day: 13 },
  { day: 14, event: { label: "Billing", color: "red" } },
  { day: 15 },
  { day: 16 },
  { day: 17 },
  { day: 18 },
  { day: 19 },
  { day: 20 },
];

export function CalendarMock() {
  return (
    <div className="p-5">
      <div className="grid grid-cols-7 gap-2">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div
            key={d}
            className="text-kicker pb-1 text-center font-mono text-[9px] tracking-[0.08em] uppercase"
          >
            {d}
          </div>
        ))}
        {CAL_DAYS.map((cell) => (
          <div
            key={cell.day}
            className="bg-surface-muted border-border relative aspect-[1/0.72] overflow-hidden rounded-lg border p-2"
          >
            <div className="text-kicker font-mono text-[10px]">{cell.day}</div>
            {cell.event ? (
              <div
                className={cn(
                  "mt-1.5 hidden truncate rounded-sm px-1.5 py-1 text-[10px] font-semibold sm:block",
                  statusToneClasses(cell.event.color, "soft"),
                )}
              >
                {cell.event.label}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

type GanttBar = {
  label: string;
  left: number;
  width: number;
  color: StatusPillColor;
  caption: string;
};

const GANTT_BARS: GanttBar[] = [
  {
    label: "Onboard designer",
    left: 0,
    width: 26,
    color: "green",
    caption: "Done",
  },
  {
    label: "Q3 launch plan",
    left: 22,
    width: 44,
    color: "primary",
    caption: "68%",
  },
  {
    label: "Realtime presence",
    left: 30,
    width: 30,
    color: "primary",
    caption: "54%",
  },
  {
    label: "Redesign billing",
    left: 40,
    width: 44,
    color: "red",
    caption: "32%",
  },
];

export function TimelineMock() {
  return (
    <div className="p-5">
      <div className="text-kicker mb-3 ml-[164px] hidden grid-cols-6 font-mono text-[9px] tracking-[0.06em] sm:grid">
        {["Jul 1", "Jul 8", "Jul 15", "Jul 22", "Jul 29", "Aug 5"].map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        {GANTT_BARS.map((bar) => (
          <div
            key={bar.label}
            className="grid grid-cols-[100px_1fr] items-center gap-3.5 sm:grid-cols-[150px_1fr]"
          >
            <div className="text-muted-foreground truncate text-[12.5px] font-semibold">
              {bar.label}
            </div>
            <div className="bg-foreground/[0.04] relative h-6 overflow-hidden rounded-sm">
              <div
                className={cn(
                  "absolute top-1 flex h-4 items-center overflow-hidden rounded-sm px-2 font-mono text-[10px] font-bold whitespace-nowrap",
                  statusToneClasses(bar.color, "solid"),
                )}
                style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
              >
                {bar.caption}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
