import { ArrowRight, Clock, LayoutGrid, Target } from "lucide-react";
import { Kicker } from "@/components/ui/kicker";
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
import {
  BoardWithAgentDock,
  MorningBriefMock,
  RollingOut,
} from "./landing-agent-mocks";
import {
  BentoTile,
  Container,
  FeatureRow,
  MiniFeatureCard,
  SectionHead,
} from "./sections/primitives";
import {
  AskPulseVisual,
  AutomationsVisual,
  CapabilityGrid,
  CommandVisual,
  DashboardVisual,
} from "./sections/visuals";

/**
 * The landing page below the hero. Composition only — primitives live in
 * `./sections/primitives`, framed product visuals in `./sections/visuals`, and
 * the agent mocks in `./landing-agent-mocks`.
 *
 * Honesty rule for this page: board agents, Ask, AI automation steps and the
 * MCP server ship today and are described in the present tense. *Named
 * per-user agents replying in item threads* do not, and every claim about them
 * carries a `<RollingOut>` marker.
 */
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

      {/* 2 · Agents ---------------------------------------------------------- */}
      <section id="agents" className="py-24 md:py-32">
        <Container>
          <LandingReveal className="mb-16">
            <SectionHead
              center
              kicker="Agents"
              title="Work alongside agents, not another tool."
              sub="Agents are members here — with a name, a job, a schedule and their own line in the activity log. They read what you can read, and nothing else."
            />
          </LandingReveal>

          <div className="flex flex-col gap-24 md:gap-28">
            <FeatureRow
              kicker="Same rooms as your team"
              title="Mention an agent. It answers in the thread."
              body="No separate chat window to check. An agent replies where the work already is — on the item, in the thread, under its own name — so the answer is visible to everyone instead of trapped in one person's history."
              points={[
                {
                  title: "Named, badged authorship",
                  sub: "Every reply says which agent wrote it, and lands in the activity log.",
                },
                {
                  title: "Documents onto the task",
                  sub: "An agent drafts a brief or a plan and attaches it to the item itself.",
                },
                {
                  title: "Your permissions, not its own",
                  sub: "An agent acts under its owner's access. Row-level security does the enforcing.",
                },
              ]}
              visual={<BoardWithAgentDock />}
              aside={<RollingOut>Named agents · rolling out</RollingOut>}
            />

            <FeatureRow
              flip
              kicker="Working while you sleep"
              title="A morning brief, without asking for it."
              body="Give an agent a cadence and a scope and it runs on schedule: sweeping your boards, flagging what slipped, and emailing you the short version before the day starts."
              points={[
                {
                  title: "Scheduled board agents",
                  sub: "Live today — agents watch a board and propose the next move.",
                },
                {
                  title: "Email digests",
                  sub: "What's pending, what's overdue, who's blocked — in your inbox.",
                },
                {
                  title: "Propose, then apply",
                  sub: "Changes arrive as proposals you confirm. Nothing moves behind your back.",
                },
              ]}
              visual={
                <WindowFrame title="Agent · Morning Brief" chip="● 7:00 daily">
                  <MorningBriefMock />
                </WindowFrame>
              }
            />
          </div>
        </Container>
      </section>

      {/* 3 · Feature deep-dives ---------------------------------------------- */}
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
                  body="No-code 'when this, do that' with 50+ triggers and actions, firing the instant a condition is met — including AI steps."
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

      {/* 4 · View switcher --------------------------------------------------- */}
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

      {/* 5 · Capability grid ------------------------------------------------- */}
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

      {/* 6 · Vision note ----------------------------------------------------- */}
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

      {/* 7 · Waitlist CTA band ----------------------------------------------- */}
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
