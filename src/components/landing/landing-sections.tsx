import type { ReactNode } from "react";
import {
  ArrowRight,
  Bell,
  Boxes,
  Clock,
  GitBranch,
  History,
  Layers,
  LayoutGrid,
  ListChecks,
  MessagesSquare,
  Paperclip,
  Shield,
  Sparkles,
  TabletSmartphone,
  Target,
  Webhook,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Kicker } from "@/components/ui/kicker";
import type { StatusColor } from "@/components/ui/status-pill";
import { statusToneClasses } from "@/components/ui/status-pill";
import {
  Avatar,
  BoardTableMock,
  BOARD_ROWS,
  KanbanMock,
  PEOPLE,
  WindowFrame,
} from "./landing-mocks";
import { LandingReveal } from "./landing-reveal";
import { LandingViewSwitcher } from "./landing-view-switcher";

/* -------------------------------------------------------------------------- */
/* Shared bits                                                                */
/* -------------------------------------------------------------------------- */

function Container({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-6 sm:px-8">{children}</div>
  );
}

function SectionHead({
  kicker,
  title,
  sub,
  center = false,
  className,
}: {
  kicker: string;
  title: string;
  sub?: string;
  center?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "max-w-[640px]",
        center && "mx-auto text-center",
        className,
      )}
    >
      <Kicker>{kicker}</Kicker>
      <h2 className="mt-4 mb-4 text-3xl leading-[1.06] font-extrabold tracking-tight sm:text-4xl md:text-[46px]">
        {title}
      </h2>
      {sub ? (
        <p className="text-muted-foreground text-base leading-relaxed sm:text-lg">
          {sub}
        </p>
      ) : null}
    </div>
  );
}

function SoftBadge({
  children,
  color,
}: {
  children: ReactNode;
  color: StatusColor | "primary";
}) {
  return (
    <span
      className={cn(
        "flex-none rounded-sm px-2 py-1 font-mono text-[9px] font-medium tracking-[0.1em] uppercase",
        statusToneClasses(color, "soft"),
      )}
    >
      {children}
    </span>
  );
}

type Point = { title: string; sub: string };

function FeatureRow({
  flip = false,
  kicker,
  title,
  body,
  points,
  visual,
}: {
  flip?: boolean;
  kicker: string;
  title: string;
  body: string;
  points: Point[];
  visual: ReactNode;
}) {
  return (
    <div className="grid items-center gap-8 md:grid-cols-[1fr_1.15fr] md:gap-14">
      <LandingReveal className={cn(flip && "md:order-2")}>
        <Kicker>{kicker}</Kicker>
        <h3 className="mt-3.5 mb-3.5 text-2xl leading-tight font-extrabold sm:text-[32px]">
          {title}
        </h3>
        <p className="text-muted-foreground mb-6 text-[17px] leading-relaxed">
          {body}
        </p>
        <ul className="flex flex-col gap-3">
          {points.map((p) => (
            <li key={p.title} className="flex items-start gap-3">
              <span
                className="bg-primary mt-2 size-1.5 flex-none rounded-full"
                aria-hidden="true"
              />
              <span className="text-[15px]">
                <b className="font-bold">{p.title}</b>
                <span className="text-muted-foreground block text-[13.5px]">
                  {p.sub}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </LandingReveal>
      <LandingReveal delayMs={100} className={cn(flip && "md:order-1")}>
        {visual}
      </LandingReveal>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Feature visuals                                                            */
/* -------------------------------------------------------------------------- */

function AutomationsVisual() {
  return (
    <WindowFrame title="Automations · Recipe">
      <div className="flex flex-col gap-3 p-5">
        <FlowNode badge={<SoftBadge color="primary">When</SoftBadge>}>
          <b className="font-bold">Status</b>{" "}
          <span className="text-muted-foreground">changes to</span>{" "}
          <b className="font-bold">Done</b>
        </FlowNode>
        <FlowConnector />
        <FlowNode badge={<SoftBadge color="teal">Then</SoftBadge>}>
          <b className="font-bold">Notify</b>{" "}
          <span className="text-muted-foreground">Dana K. in</span>{" "}
          <b className="font-bold">#launch</b>
        </FlowNode>
        <FlowConnector />
        <FlowNode badge={<SoftBadge color="teal">Then</SoftBadge>}>
          <b className="font-bold">Move item</b>{" "}
          <span className="text-muted-foreground">to</span>{" "}
          <b className="font-bold">Q4 roadmap</b>
        </FlowNode>
      </div>
    </WindowFrame>
  );
}

function FlowNode({
  badge,
  children,
}: {
  badge: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-surface-muted border-border flex items-center gap-3.5 rounded-lg border px-4 py-3.5">
      {badge}
      <div className="text-sm">{children}</div>
    </div>
  );
}

function FlowConnector() {
  return <div className="bg-border ml-9 h-3.5 w-px" aria-hidden="true" />;
}

function AskPulseVisual() {
  return (
    <WindowFrame title="Ask AI" chip="⌘K">
      <div className="p-5">
        <div className="mb-4">
          <div className="text-kicker mb-2 flex items-center gap-1.5 font-mono text-[10px] tracking-[0.1em] uppercase">
            You
          </div>
          <div className="bg-surface-muted border-border inline-block rounded-lg border px-3.5 py-3 text-[14.5px]">
            What&apos;s at risk in the Q3 launch and who&apos;s blocked?
          </div>
        </div>
        <div>
          <div className="text-kicker mb-2 flex items-center gap-1.5 font-mono text-[10px] tracking-[0.1em] uppercase">
            <Sparkles className="text-primary size-3" />
            AI
          </div>
          <div className="bg-primary/[0.06] border-primary/20 rounded-lg border px-4 py-3.5 text-[14.5px] leading-relaxed">
            Two items need attention.{" "}
            <span className="text-primary font-bold">
              Redesign billing flow
            </span>{" "}
            is <b className="font-bold">Blocked</b> on Sofia R. and 6 days
            behind.{" "}
            <span className="text-primary font-bold">
              Ship realtime presence
            </span>{" "}
            is on track at 54%.
            <div className="mt-3 flex flex-wrap gap-1.5">
              <SoftPill color="red">1 blocked</SoftPill>
              <SoftPill color="blue">2 in progress</SoftPill>
              <SoftPill color="green">1 done</SoftPill>
            </div>
          </div>
        </div>
      </div>
    </WindowFrame>
  );
}

function SoftPill({
  children,
  color,
}: {
  children: ReactNode;
  color: StatusColor;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-2.5 py-0.5 text-[11px] font-semibold",
        statusToneClasses(color, "soft"),
      )}
    >
      {children}
    </span>
  );
}

function CommandVisual() {
  return (
    <WindowFrame title="Command · ⌘K" chip="AI">
      <div className="flex flex-col gap-3.5 p-5">
        <div className="bg-surface-muted border-border-hover flex items-center gap-3 rounded-lg border px-4 py-3.5">
          <Sparkles className="text-primary size-3.5 flex-none" />
          <span className="text-[14.5px]">
            Create a board to track Q4 hiring, with stages and owners
          </span>
          <span
            className="bg-primary ml-0.5 h-4 w-0.5 flex-none rounded-full"
            aria-hidden="true"
          />
        </div>
        <div className="text-kicker font-mono text-[10px] tracking-[0.1em] uppercase">
          Proposed · confirm to run
        </div>
        <div className="flex flex-col gap-2.5">
          <CmdStep badge={<SoftBadge color="primary">New board</SoftBadge>}>
            <b className="font-bold">&quot;Q4 Hiring&quot;</b>
          </CmdStep>
          <CmdStep badge={<SoftBadge color="teal">Stages</SoftBadge>}>
            <span className="text-muted-foreground">
              Sourced, Screen, Onsite, Offer
            </span>
          </CmdStep>
          <CmdStep badge={<SoftBadge color="teal">Columns</SoftBadge>}>
            <span className="text-muted-foreground">
              Owner, Role, Status, Start date
            </span>
          </CmdStep>
        </div>
        <div className="mt-0.5 flex items-center justify-end gap-3.5">
          <span className="text-kicker font-mono text-[10px] tracking-[0.08em]">
            ↵ to run · esc to edit
          </span>
          <span className="bg-primary text-primary-foreground shadow-glow-primary rounded-full px-4 py-2 text-[12.5px] font-bold">
            Confirm &amp; run
          </span>
        </div>
      </div>
    </WindowFrame>
  );
}

function CmdStep({
  badge,
  children,
}: {
  badge: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-primary/[0.05] border-primary/[0.18] flex items-center gap-3 rounded-lg border px-3.5 py-3 text-[13.5px]">
      {badge}
      <span>{children}</span>
    </div>
  );
}

function DashboardVisual() {
  const bars = [
    { label: "W1", height: 44, muted: true },
    { label: "W2", height: 60, muted: true },
    { label: "W3", height: 72, muted: false },
    { label: "W4", height: 88, muted: false },
    { label: "W5", height: 66, muted: false },
    { label: "W6", height: 96, muted: false },
  ];
  return (
    <WindowFrame title="Dashboard · Q3 overview">
      <div className="grid grid-cols-2 gap-4 p-5">
        <Kpi label="On track" value="24" delta="▲ 12%" up />
        <Kpi label="Blocked" value="3" delta="▲ 1" />
        <div className="bg-surface-muted border-border col-span-2 rounded-lg border px-4 py-4">
          <div className="text-kicker mb-3.5 font-mono text-[9px] tracking-[0.1em] uppercase">
            Velocity by week
          </div>
          <div className="flex h-24 items-end gap-2.5 pb-6">
            {bars.map((b) => (
              <div
                key={b.label}
                className={cn(
                  "relative flex-1 rounded-t-md",
                  b.muted ? "bg-foreground/15" : "bg-primary/80",
                )}
                style={{ height: `${b.height}%` }}
              >
                <span className="text-kicker absolute inset-x-0 -bottom-5 text-center font-mono text-[9px]">
                  {b.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </WindowFrame>
  );
}

function Kpi({
  label,
  value,
  delta,
  up = false,
}: {
  label: string;
  value: string;
  delta: string;
  up?: boolean;
}) {
  return (
    <div className="bg-surface-muted border-border rounded-lg border p-4">
      <div className="text-kicker font-mono text-[9px] tracking-[0.1em] uppercase">
        {label}
      </div>
      <div className="mt-2 mb-1 text-3xl font-extrabold tracking-tight">
        {value}
      </div>
      <div
        className={cn(
          "text-xs font-bold",
          up ? "text-status-green" : "text-status-red",
        )}
      >
        {delta}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Feature composition helpers                                                */
/* -------------------------------------------------------------------------- */

/**
 * A single bento cell: a mono kicker, short title, one-line body, and a framed
 * product visual that clips to the tile. Span classes (col/row) come in via
 * `className` so the grid can vary each tile's footprint. Lifts on hover.
 */
function BentoTile({
  kicker,
  title,
  body,
  className,
  delayMs = 0,
  children,
}: {
  kicker: string;
  title: string;
  body: string;
  className?: string;
  delayMs?: number;
  children: ReactNode;
}) {
  return (
    <LandingReveal delayMs={delayMs} className={cn("min-w-0", className)}>
      <div className="bg-surface border-border ease-keystone hover:border-border-hover flex h-full flex-col rounded-lg border p-5 transition-[transform,border-color] duration-300 hover:-translate-y-1">
        <Kicker>{kicker}</Kicker>
        <h3 className="mt-2.5 mb-1.5 text-lg leading-tight font-bold tracking-tight">
          {title}
        </h3>
        <p className="text-muted-foreground text-[13.5px] leading-relaxed">
          {body}
        </p>
        <div className="mt-5 min-h-0 flex-1 overflow-hidden rounded-lg">
          {children}
        </div>
      </div>
    </LandingReveal>
  );
}

/**
 * Compact icon card for the "Plan & manage" cluster: a periwinkle-tinted icon
 * chip, a bold title, and a one-liner. No mock — pure, quiet, three-up.
 */
function MiniFeatureCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Target;
  title: string;
  body: string;
}) {
  return (
    <div className="bg-surface-muted border-border ease-keystone hover:border-border-hover flex h-full flex-col rounded-lg border p-5 transition-[transform,border-color] duration-300 hover:-translate-y-1">
      <div className="bg-primary/10 text-primary mb-4 inline-flex size-9 items-center justify-center rounded-lg">
        <Icon className="size-[18px]" aria-hidden="true" />
      </div>
      <h4 className="mb-1.5 text-[15px] font-bold tracking-tight">{title}</h4>
      <p className="text-muted-foreground text-[13.5px] leading-relaxed">
        {body}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Capability grid                                                            */
/* -------------------------------------------------------------------------- */

const CAPABILITIES: {
  category: string;
  title: string;
  body: string;
  icon: typeof Layers;
}[] = [
  {
    category: "Structure",
    title: "Custom fields & statuses",
    body: "Model any workflow with typed columns and your own status sets.",
    icon: Layers,
  },
  {
    category: "Structure",
    title: "Subitems & checklists",
    body: "Break work down without ever leaving the row.",
    icon: ListChecks,
  },
  {
    category: "Structure",
    title: "Relations & mirror columns",
    body: "Link boards and pull live values across them, with aggregation.",
    icon: GitBranch,
  },
  {
    category: "Structure",
    title: "Board templates",
    body: "Spin up a proven structure in a single click.",
    icon: Boxes,
  },
  {
    category: "Collaborate",
    title: "Updates & @mentions",
    body: "Discuss in context, loop people in, keep the thread on the item.",
    icon: MessagesSquare,
  },
  {
    category: "Collaborate",
    title: "Notifications inbox",
    body: "One place for everything that actually needs you.",
    icon: Bell,
  },
  {
    category: "Collaborate",
    title: "Activity log",
    body: "Every change, attributed and timestamped.",
    icon: History,
  },
  {
    category: "Collaborate",
    title: "File attachments",
    body: "Drop files on any item and preview them inline.",
    icon: Paperclip,
  },
  {
    category: "Platform",
    title: "Org-scoped security",
    body: "Row-level isolation by default. Your data never crosses tenants.",
    icon: Shield,
  },
  {
    category: "Platform",
    title: "Realtime presence & sync",
    body: "See who's here and every edit the moment it lands.",
    icon: Zap,
  },
  {
    category: "Platform",
    title: "iPad & touch ready",
    body: "Full drag-and-drop and inline editing on touch.",
    icon: TabletSmartphone,
  },
  {
    category: "Platform",
    title: "Webhooks & API",
    body: "Push events out to the tools you already run.",
    icon: Webhook,
  },
];

function CapabilityGrid() {
  return (
    <div className="mt-11 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
      {CAPABILITIES.map((cap) => {
        const Icon = cap.icon;
        return (
          <div
            key={cap.title}
            className="bg-surface border-border hover:border-border-hover rounded-lg border p-4 transition-colors"
          >
            <div className="text-kicker mb-3 flex items-center gap-2 font-mono text-[9px] tracking-[0.12em] uppercase">
              <Icon className="size-3.5" aria-hidden="true" />
              {cap.category}
            </div>
            <h4 className="mb-1.5 text-sm font-bold tracking-tight">
              {cap.title}
            </h4>
            <p className="text-muted-foreground text-[12.5px] leading-relaxed">
              {cap.body}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Root                                                                       */
/* -------------------------------------------------------------------------- */

export function LandingSections({ signedIn = false }: { signedIn?: boolean }) {
  const ctaHref = signedIn ? "/boards" : "#waitlist";
  const ctaLabel = signedIn ? "Open Monolith" : "Request access";

  return (
    <div className="relative isolate">
      {/* Ambient gradient atmosphere: lifts the sections off flat black with a
          restrained periwinkle bloom top/mid/bottom, blending down from the
          hero's near-black tone. Decorative, dark-locked. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: [
            "radial-gradient(64% 42% at 50% 0%, rgba(142,162,235,0.07), transparent 68%)",
            "radial-gradient(74% 42% at 50% 100%, rgba(142,162,235,0.07), transparent 70%)",
            "linear-gradient(180deg, #06070c 0%, #08090e 60%, #090a0f 100%)",
          ].join(", "),
        }}
      />

      {/* 1 · Product showcase ------------------------------------------------ */}
      <section id="reveal" className="py-24 md:py-32">
        <Container>
          <LandingReveal>
            <SectionHead
              center
              kicker="The workspace"
              title="This is your workspace."
              sub="Every project, task, and update: live, editable, and shared. What your whole team sees the moment they log in."
            />
          </LandingReveal>
          <LandingReveal className="mt-14">
            <WindowFrame
              title="Product · Q3 launch plan"
              chip="● 4 online · realtime"
            >
              <BoardTableMock rows={BOARD_ROWS} />
            </WindowFrame>
          </LandingReveal>
        </Container>
      </section>

      {/* 2 · Feature deep-dives ---------------------------------------------- */}
      <section id="features" className="py-24 md:py-32">
        <Container>
          <LandingReveal className="mb-16">
            <SectionHead
              center
              kicker="What's inside"
              title="Everything, on one surface."
            />
          </LandingReveal>

          <div className="flex flex-col gap-24 md:gap-28">
            <FeatureRow
              kicker="Boards & views"
              title="One dataset. Every angle."
              body="Table, Kanban, Calendar, Timeline. The same items, rendered how each person thinks. Inline-edit any cell and every change syncs in real-time, with live presence so you see exactly who's in the board with you."
              points={[
                {
                  title: "Four board views",
                  sub: "Table, Kanban, Calendar, and Timeline with dependencies.",
                },
                {
                  title: "Built to fit your work",
                  sub: "Custom fields and statuses, subitems, and board templates.",
                },
                {
                  title: "Relations & mirror columns",
                  sub: "Link boards and roll values up with aggregation.",
                },
              ]}
              visual={
                <WindowFrame title="Views · Kanban">
                  <KanbanMock
                    columns={[
                      {
                        name: "In progress",
                        color: "blue",
                        cards: [
                          {
                            task: "Ship realtime presence",
                            owner: PEOPLE.theo,
                            priority: { label: "High", color: "red" },
                          },
                          {
                            task: "Q3 launch plan",
                            owner: PEOPLE.dana,
                            priority: { label: "High", color: "red" },
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
                    ]}
                    className="lg:grid-cols-2"
                  />
                </WindowFrame>
              }
            />

            {/* Format B · bento grid — the AI + automations + dashboards cluster,
                in deliberately varied footprints. */}
            <div>
              <LandingReveal className="mb-10 text-center">
                <Kicker>Intelligence</Kicker>
                <h3 className="mt-3 text-2xl leading-tight font-extrabold tracking-tight sm:text-3xl">
                  The workspace thinks with you.
                </h3>
              </LandingReveal>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
                <BentoTile
                  className="md:col-span-4 md:row-span-2"
                  kicker="Ask AI"
                  title="Ask your workspace anything."
                  body="Natural-language answers from every board, doc, and update, with live numbers instead of stale exports. Inside any item, AI drafts, rewrites, summarizes, and catches you up on long threads."
                >
                  <AskPulseVisual />
                </BentoTile>

                <BentoTile
                  className="md:col-span-2"
                  delayMs={80}
                  kicker="Automations"
                  title="Rules that run themselves."
                  body="No-code 'when this, do that' with 50+ triggers and actions, firing the instant a condition is met."
                >
                  <AutomationsVisual />
                </BentoTile>

                <BentoTile
                  className="md:col-span-2"
                  delayMs={160}
                  kicker="AI · ⌘K actions"
                  title="Say it. Watch it happen."
                  body="Describe a change in plain language: it proposes, you confirm, it runs. Whole boards, automations, and imports from one prompt."
                >
                  <CommandVisual />
                </BentoTile>

                <BentoTile
                  className="md:col-span-6"
                  delayMs={120}
                  kicker="Dashboards"
                  title="Charts that build themselves."
                  body="Nine chart types across every board, or just describe what you want and let AI assemble the dashboard. Time tracking and workload roll up automatically."
                >
                  <DashboardVisual />
                </BentoTile>
              </div>
            </div>

            {/* Format C · compact three-up icon cards — plan & manage. */}
            <div>
              <LandingReveal className="mb-10 text-center">
                <Kicker>Plan & manage</Kicker>
                <h3 className="mt-3 text-2xl leading-tight font-extrabold tracking-tight sm:text-3xl">
                  Zoom out from tasks to outcomes.
                </h3>
              </LandingReveal>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <LandingReveal>
                  <MiniFeatureCard
                    icon={Target}
                    title="Goals & OKRs"
                    body="Tie daily work to the outcomes that matter."
                  />
                </LandingReveal>
                <LandingReveal delayMs={80}>
                  <MiniFeatureCard
                    icon={LayoutGrid}
                    title="Portfolios & workload"
                    body="Many boards in one view; balance capacity at a glance."
                  />
                </LandingReveal>
                <LandingReveal delayMs={160}>
                  <MiniFeatureCard
                    icon={Clock}
                    title="Time tracking"
                    body="Timers and manual entries in one actuals ledger."
                  />
                </LandingReveal>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* 3 · View switcher --------------------------------------------------- */}
      <section id="views" className="py-24 md:py-32">
        <Container>
          <LandingReveal className="mb-9">
            <SectionHead
              center
              kicker="Live views · 0 reloads"
              title="Switch how you see it."
              sub="The same 'Q3 launch plan' board, four ways. Toggle instantly, with no page reload and no refetch."
            />
          </LandingReveal>
          <LandingReveal>
            <LandingViewSwitcher />
          </LandingReveal>
        </Container>
      </section>

      {/* 4 · Capability grid ------------------------------------------------- */}
      <section id="more" className="py-24 md:py-32">
        <Container>
          <LandingReveal>
            <SectionHead
              center
              kicker="Everything else"
              title="And all the connective tissue."
              sub="The details that make one surface actually replace the stack."
            />
            <CapabilityGrid />
          </LandingReveal>
        </Container>
      </section>

      {/* 5 · Vision note ----------------------------------------------------- */}
      <section
        id="vision"
        className="bg-surface border-border border-y py-24 md:py-32"
      >
        <Container>
          <LandingReveal className="mx-auto max-w-[820px] text-center">
            <Kicker>From the founder</Kicker>
            <blockquote className="my-7 text-2xl leading-snug font-semibold tracking-tight sm:text-3xl">
              Teams don&apos;t fail for lack of tools. They fail from the{" "}
              <span className="text-primary">friction between them</span>: the
              copy-paste, the stale status, the &quot;which tab was that
              in?&quot; Monolith collapses that gap into a single, living
              surface.
            </blockquote>
            <div className="flex items-center justify-center gap-3.5">
              <Avatar
                person={{
                  initials: "DJ",
                  name: "Danijel Jovanovic",
                  tone: "primary",
                }}
                size="lg"
              />
              <div className="text-left">
                <div className="text-sm font-bold">Danijel Jovanovic</div>
                <div className="text-muted-foreground text-[12.5px]">
                  Founder, Monolith
                </div>
              </div>
            </div>
          </LandingReveal>
        </Container>
      </section>

      {/* 6 · Waitlist CTA band ----------------------------------------------- */}
      <section
        id="waitlist"
        className="relative isolate overflow-hidden py-24 md:py-32"
      >
        {/* Focused periwinkle bloom behind the final CTA. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-1/2 -z-10 h-[440px] w-[860px] max-w-[130vw] -translate-x-1/2 -translate-y-1/2"
          style={{
            background:
              "radial-gradient(closest-side, rgba(142,162,235,0.12), transparent 75%)",
          }}
        />
        <Container>
          <LandingReveal className="mx-auto max-w-[640px] text-center">
            <Kicker>{signedIn ? "Your workspace" : "Request access"}</Kicker>
            <h2 className="mt-4 mb-4 text-3xl leading-[1.06] font-extrabold tracking-tight sm:text-4xl md:text-[46px]">
              {signedIn ? "Jump back in." : "Be there for the reveal."}
            </h2>
            <p className="text-muted-foreground text-base leading-relaxed sm:text-lg">
              {signedIn
                ? "Everything your team ships, on one surface. Pick up right where you left off."
                : "We're onboarding teams in small batches. Add your email and we'll send an invite when your wave opens."}
            </p>

            {signedIn ? (
              <div className="mt-8">
                <a
                  href={ctaHref}
                  className="bg-primary text-primary-foreground shadow-glow-primary ease-keystone inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-[15px] font-bold transition-[filter] duration-300 hover:brightness-110"
                >
                  {ctaLabel}
                  <ArrowRight className="size-4" />
                </a>
              </div>
            ) : (
              <div className="mx-auto mt-8 flex max-w-[480px] flex-wrap justify-center gap-3">
                <input
                  type="email"
                  aria-label="Email address"
                  placeholder="you@company.com"
                  className="text-foreground placeholder:text-kicker border-border bg-foreground/[0.04] focus:border-border-bright min-w-[220px] flex-1 rounded-full border px-5 py-3.5 text-[15px] transition-colors outline-none"
                />
                <button
                  type="button"
                  className="bg-primary text-primary-foreground shadow-glow-primary ease-keystone rounded-full px-6 py-3.5 text-[15px] font-bold whitespace-nowrap transition-[filter] duration-300 hover:brightness-110"
                >
                  Request access
                </button>
              </div>
            )}

            <div className="text-kicker mt-4 font-mono text-xs tracking-[0.04em]">
              {signedIn
                ? "Invite-only. Rolling out in waves."
                : "No spam. We onboard in small batches."}
            </div>
          </LandingReveal>
        </Container>
      </section>
    </div>
  );
}
