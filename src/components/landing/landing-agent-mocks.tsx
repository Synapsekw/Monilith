import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { StatusColor } from "@/components/ui/status-pill";
import { statusToneClasses } from "@/components/ui/status-pill";
import {
  Avatar,
  BoardTableMock,
  PEOPLE,
  SWITCHER_ROWS,
  WindowFrame,
} from "./landing-mocks";

/**
 * Landing mocks for the agentic surface: agents as named members that reply in
 * the threads humans already use, and write documents onto the task.
 *
 * Presentational Server Components — no state, no handlers. Shipped copy stays
 * honest about what is live today: board agents, Ask, AI automation steps and
 * the MCP server exist; *named per-user agents in item threads* are still
 * rolling out, which is what `<RollingOut>` marks.
 */

/** Marks capability that is real but not yet generally available. */
export function RollingOut({ children }: { children: ReactNode }) {
  return (
    <span className="border-border text-kicker text-3xs inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono tracking-[0.12em] uppercase">
      <span
        aria-hidden="true"
        className="bg-primary size-1.5 flex-none rounded-full"
        style={{ boxShadow: "0 0 8px 1px rgba(142, 162, 235, 0.85)" }}
      />
      {children}
    </span>
  );
}

/** The `AGENT` chip that distinguishes an agent author from a human one. */
export function AgentBadge() {
  return (
    <span className="border-border text-kicker text-3xs flex-none rounded-sm border px-1.5 py-px font-mono tracking-[0.12em]">
      AGENT
    </span>
  );
}

/**
 * An agent's avatar. Deliberately NOT a status-toned human avatar: agents get
 * the periwinkle ring so authorship is legible at a glance without relying on
 * the badge text alone.
 */
export function AgentAvatar({
  initials,
  className,
}: {
  initials: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "bg-primary/15 text-primary ring-primary/40 text-3xs inline-flex size-[26px] flex-none items-center justify-center rounded-full font-bold ring-1",
        className,
      )}
    >
      {initials}
    </span>
  );
}

/** An `@mention` chip as it renders inside an update. */
function Mention({ children }: { children: ReactNode }) {
  return (
    <span className="bg-primary/[0.12] text-primary rounded-sm px-1 py-px font-semibold">
      @{children}
    </span>
  );
}

export type LandingAgent = {
  initials: string;
  name: string;
  role: string;
};

/** The named agents shown on the landing. Illustrative, not seeded data. */
export const LANDING_AGENTS: LandingAgent[] = [
  {
    initials: "MB",
    name: "Morning Brief",
    role: "emails what's pending, 7:00",
  },
  { initials: "TR", name: "Triage", role: "sorts and assigns new items" },
  {
    initials: "ST",
    name: "Standup",
    role: "posts yesterday / today / blocked",
  },
  { initials: "RV", name: "Reviewer", role: "flags overdue and at-risk" },
];

/** Humans and agents in the same thread, on the same item. */
export function AgentThreadMock({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex items-center gap-2.5 border-b px-4 py-3">
        <span className="text-kicker text-3xs flex-none font-mono tracking-[0.12em]">
          THREAD
        </span>
        <span className="truncate text-sm font-semibold">
          Redesign billing flow
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-4 px-4 py-4">
        <div className="flex gap-2.5">
          <Avatar person={PEOPLE.sofia} />
          <div className="min-w-0">
            <div className="text-muted-foreground text-2xs mb-1">
              {PEOPLE.sofia.name}
            </div>
            <div className="text-sm leading-relaxed">
              <Mention>Triage</Mention> what&apos;s actually blocking this?
            </div>
          </div>
        </div>

        <div className="flex gap-2.5">
          <AgentAvatar initials="TR" />
          <div className="min-w-0">
            <div className="text-muted-foreground text-2xs mb-1 flex items-center gap-2">
              Triage
              <AgentBadge />
            </div>
            <div className="text-sm leading-relaxed">
              Two dependencies are late:{" "}
              <b className="font-bold">Ship realtime presence</b>
              {" (Theo, 54%) and the Stripe webhook spike. "}
              I&apos;ve drafted the unblocking plan.
            </div>
            <div className="border-border bg-surface-muted mt-2.5 inline-flex items-center gap-2 rounded-sm border px-2.5 py-1.5">
              <span className="text-primary text-3xs font-mono">PDF</span>
              <span className="text-muted-foreground text-xs">
                Billing-unblock-plan.pdf
              </span>
            </div>
            <div className="text-kicker text-3xs mt-1.5 font-mono tracking-[0.1em]">
              ATTACHED TO THIS TASK
            </div>
          </div>
        </div>

        {compact ? null : (
          <div className="flex gap-2.5">
            <AgentAvatar initials="MB" />
            <div className="min-w-0">
              <div className="text-muted-foreground text-2xs mb-1 flex items-center gap-2">
                Morning Brief
                <AgentBadge />
              </div>
              <div className="text-sm leading-relaxed">
                Added to tomorrow&apos;s 7:00 digest for the three owners.
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="border-border border-t px-4 py-3">
        <div className="border-border text-muted-foreground rounded-sm border px-3 py-2 text-xs">
          Ask an agent…
        </div>
      </div>
    </div>
  );
}

/**
 * What a scheduled agent actually delivers: the morning digest, addressed by
 * name, with the three things that need the owner today.
 */
export function MorningBriefMock() {
  const lines: {
    label: string;
    color: StatusColor;
    task: string;
    meta: string;
  }[] = [
    {
      label: "Blocked",
      color: "red",
      task: "Redesign billing flow",
      meta: "6 days behind · Sofia R.",
    },
    {
      label: "Due today",
      color: "orange",
      task: "Ship realtime presence",
      meta: "54% · Theo L.",
    },
    {
      label: "Not started",
      color: "gray",
      task: "Draft Q4 roadmap",
      meta: "starts Jul 28 · Elias V.",
    },
  ];

  return (
    <div className="p-5">
      <div className="border-border mb-4 flex items-center gap-2.5 border-b pb-4">
        <AgentAvatar initials="MB" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Morning Brief</span>
            <AgentBadge />
          </div>
          <div className="text-muted-foreground text-2xs">
            to Dana K. · 7:00
          </div>
        </div>
      </div>

      <p className="mb-4 text-sm leading-relaxed">
        Good morning — <b className="font-bold">three items</b> need you today.
      </p>

      <ul className="flex flex-col gap-2.5">
        {lines.map((line) => (
          <li
            key={line.task}
            className="bg-surface-muted border-border flex items-center gap-3 rounded-lg border px-3.5 py-3"
          >
            <span
              className={cn(
                "text-2xs inline-flex flex-none items-center gap-1.5 rounded-sm px-2.5 py-1 font-semibold whitespace-nowrap",
                statusToneClasses(line.color, "soft"),
              )}
            >
              <span
                className="size-1.5 rounded-full bg-current"
                aria-hidden="true"
              />
              {line.label}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">
                {line.task}
              </span>
              <span className="text-muted-foreground text-2xs block">
                {line.meta}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <div className="text-kicker text-3xs mt-4 font-mono tracking-[0.1em] uppercase">
        Sent every weekday · unsubscribe any time
      </div>
    </div>
  );
}

/** Board on the left, the agent thread docked beside it — one surface. */
export function BoardWithAgentDock() {
  return (
    <WindowFrame title="Product · Q3 launch plan" chip="● 2 agents · live">
      {/*
        `min-w-0` on both columns is load-bearing: a grid item defaults to
        `min-width: auto`, so without it the column sizes to the table's
        720px min-width and pushes the whole page into horizontal scroll on
        mobile. With it, `overflow-x-auto` inside the panel does its job.
      */}
      <div className="grid lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        {/* The board is narrower than the table's min-width beside the dock, so
            its trailing columns are clipped. Fade the right edge so that reads
            as "more columns over there" rather than as a sliced-off pill. */}
        <div
          className="border-border/70 min-w-0 lg:border-r"
          style={{
            maskImage: "linear-gradient(to right, #000 88%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to right, #000 88%, transparent 100%)",
          }}
        >
          <BoardTableMock rows={SWITCHER_ROWS} />
        </div>
        <div className="border-border/70 min-w-0 border-t lg:border-t-0">
          <AgentThreadMock />
        </div>
      </div>
    </WindowFrame>
  );
}

/** The roster: an org's named agents, each one a member with its own job. */
export function AgentRoster({ className }: { className?: string }) {
  return (
    <ul className={cn("grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {LANDING_AGENTS.map((agent) => (
        <li
          key={agent.name}
          className="border-border bg-surface/70 hover:border-border-hover flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors"
        >
          <AgentAvatar initials={agent.initials} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold">
                {agent.name}
              </span>
              <AgentBadge />
            </div>
            <div className="text-muted-foreground text-2xs mt-0.5 leading-snug">
              {agent.role}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
