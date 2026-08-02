import { Kicker } from "@/components/ui/kicker";
import { Avatar, WindowFrame } from "./landing-mocks";
import { LandingReveal } from "./landing-reveal";
import { LandingViewSwitcher } from "./landing-view-switcher";
import {
  AgentThreadMock,
  MorningBriefMock,
  RollingOut,
} from "./landing-agent-mocks";
import { BentoTile, FeatureRow, SectionHead } from "./sections/primitives";
import {
  AskPulseVisual,
  AutomationsVisual,
  CommandVisual,
  DashboardVisual,
} from "./sections/visuals";
import {
  AccessBand,
  Band,
  CapabilityList,
  FaqBand,
  SecurityBand,
  TrustStrip,
} from "./sections/bands";

/**
 * The landing page below the hero — composition only. Primitives live in
 * `./sections/primitives`, framed product visuals in `./sections/visuals`, the
 * standing bands in `./sections/bands`, and the agent mocks in
 * `./landing-agent-mocks`.
 *
 * No section carries a background. The page has one continuous wash behind it
 * (`monolith-hero.module.css`): a section-level background necessarily draws a
 * boundary, and those boundaries are what made this read as stacked grey slabs.
 *
 * Honesty rule: board agents, Ask, AI automation steps and the MCP server ship
 * today and are described in the present tense. Named per-user agents replying
 * in item threads do not, so every claim about them carries a `<RollingOut>`
 * marker.
 */
export function LandingSections({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <div className="relative">
      <TrustStrip />

      {/* 1 · Boards & views — the switcher leads, rather than arriving late. */}
      <Band id="boards">
        <LandingReveal>
          <SectionHead
            center
            kicker="Boards & views"
            title="One dataset. Every angle."
            sub="The same items rendered how each person thinks. Toggle instantly — no page reload, no refetch."
          />
        </LandingReveal>
        <LandingReveal className="mt-14">
          <LandingViewSwitcher />
        </LandingReveal>
      </Band>

      {/* 2 · Agents. */}
      <Band id="agents">
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
            visual={
              <WindowFrame
                title="Item · Redesign billing flow"
                chip="● 2 agents"
              >
                <AgentThreadMock />
              </WindowFrame>
            }
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
      </Band>

      {/* 3 · Intelligence. */}
      <Band id="intelligence">
        <LandingReveal className="mb-14">
          <SectionHead
            center
            kicker="Intelligence"
            title="The workspace thinks with you."
            sub="Ask it anything, let it build the automation, and watch the dashboard assemble itself."
          />
        </LandingReveal>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
          <BentoTile
            className="md:col-span-4 md:row-span-2"
            kicker="Ask AI"
            title="Ask your workspace anything."
            body="Natural-language answers from every board, doc and update, with live numbers instead of stale exports. Inside any item, AI drafts, rewrites, summarizes, and catches you up on long threads."
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
            body="Describe a change in plain language: it proposes, you confirm, it runs. Whole boards, automations and imports from one prompt."
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
      </Band>

      {/* 4 · Security — the tour's closing argument. */}
      <SecurityBand />

      {/* 5 · Everything else. */}
      <CapabilityList />

      {/* 6 · Vision note. */}
      <Band id="vision">
        <LandingReveal className="mx-auto max-w-[820px] text-center">
          <Kicker>From the founder</Kicker>
          <blockquote className="my-7 text-2xl leading-snug font-semibold tracking-tight sm:text-3xl">
            Teams don&apos;t fail for lack of tools. They fail from the{" "}
            <span className="text-primary">friction between them</span>: the
            copy-paste, the stale status, the &quot;which tab was that in?&quot;
            Monolith collapses that gap into a single, living surface — and now
            staffs it.
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
              <div className="text-muted-foreground text-xs">
                Founder, Monolith
              </div>
            </div>
          </div>
        </LandingReveal>
      </Band>

      {/* 7 · Questions. */}
      <FaqBand />

      {/* 8 · Closing CTA. */}
      <AccessBand signedIn={signedIn} />
    </div>
  );
}
