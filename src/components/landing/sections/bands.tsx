import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Fingerprint,
  KeyRound,
  Plug,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Kicker } from "@/components/ui/kicker";
import { LandingReveal } from "../landing-reveal";
import { Container, SectionHead } from "./primitives";

/**
 * The standing bands of the landing page: trust strip, security, capabilities,
 * FAQ and the closing access CTA.
 *
 * None of them carry a background. The page has one continuous wash behind it
 * (`monolith-hero.module.css`), because a per-section background necessarily
 * draws a boundary and those boundaries are what made the page read as a stack
 * of grey slabs.
 *
 * Copy rule: everything here describes what ships. No invented pricing — Stripe
 * is not wired, so a tier table would be exactly the over-claim the rollout
 * markers exist to prevent.
 */

/** Shared vertical rhythm. Sections no longer sit on slabs, so the air between
 *  them is doing the separating and does not need to be as large. */
export const BAND = "py-20 md:py-28";

export function Band({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={cn(BAND, className)}>
      <Container>{children}</Container>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Trust strip                                                                */
/* -------------------------------------------------------------------------- */

const STRIP = [
  { icon: ShieldCheck, label: "Row-level isolation" },
  { icon: Fingerprint, label: "Agents act as their owner" },
  { icon: Plug, label: "MCP over OAuth 2.1" },
  { icon: KeyRound, label: "Bring your own AI keys" },
];

export function TrustStrip() {
  return (
    <section className="py-10 md:py-12">
      <Container>
        <LandingReveal>
          <div className="grid gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
            {STRIP.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="flex items-center gap-3">
                  <Icon
                    className="text-primary size-4 flex-none"
                    aria-hidden="true"
                  />
                  <span className="text-[13.5px] font-medium">
                    {item.label}
                  </span>
                </div>
              );
            })}
          </div>
        </LandingReveal>
      </Container>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Security                                                                   */
/* -------------------------------------------------------------------------- */

const SECURITY: [string, string, string][] = [
  ["01", "Org isolation", "Enforced in Postgres, not in app code."],
  ["02", "Acts as its owner", "An agent reaches exactly what you reach."],
  ["03", "Propose, then apply", "A human confirms every change."],
  ["04", "One audit log", "Every action attributed and timestamped."],
];

export function SecurityBand() {
  return (
    <Band id="security">
      <LandingReveal>
        <SectionHead
          center
          kicker="Security & control"
          title="Agents you can actually let in."
          sub="Row-level isolation in the database, agents acting as their owner, proposals before changes, and one audit log for humans and agents alike."
        />
      </LandingReveal>
      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SECURITY.map(([index, title, body], i) => (
          <LandingReveal key={title} delayMs={i * 70}>
            <div className="bg-surface/60 border-border hover:border-border-hover h-full rounded-lg border p-5 transition-colors">
              <Kicker index={index}>{title}</Kicker>
              <p className="text-muted-foreground mt-3 text-[13.5px] leading-relaxed">
                {body}
              </p>
            </div>
          </LandingReveal>
        ))}
      </div>
    </Band>
  );
}

/* -------------------------------------------------------------------------- */
/* Capabilities                                                               */
/* -------------------------------------------------------------------------- */

const CAPABILITY_GROUPS: { group: string; items: string[] }[] = [
  {
    group: "Plan & structure",
    items: [
      "Custom fields & statuses",
      "Subitems & checklists",
      "Relations & mirror columns",
      "Board templates",
      "Goals & OKRs",
      "Portfolios & workload",
      "Time tracking",
    ],
  },
  {
    group: "Collaborate",
    items: [
      "Updates & @mentions",
      "Notifications inbox",
      "Activity log",
      "File attachments",
      "Realtime presence",
      "iPad & touch ready",
    ],
  },
  {
    group: "Platform",
    items: [
      "Org-scoped row-level security",
      "MCP server (OAuth 2.1)",
      "Scheduled board agents",
      "Webhooks & API",
      "Email digests",
      "Bring your own AI keys",
    ],
  },
];

/** Three scannable columns. This was fourteen cards; same information, roughly
 *  a third of the vertical cost, and it stops reading as a wall. */
export function CapabilityList() {
  return (
    <Band id="more">
      <LandingReveal>
        <SectionHead
          center
          kicker="Everything else"
          title="And all the connective tissue."
          sub="The details that make one surface actually replace the stack."
        />
      </LandingReveal>
      <div className="mt-14 grid gap-10 sm:grid-cols-3">
        {CAPABILITY_GROUPS.map((group, i) => (
          <LandingReveal key={group.group} delayMs={i * 80}>
            <Kicker index={`0${i + 1}`}>{group.group}</Kicker>
            <ul className="border-border mt-4 flex flex-col border-t">
              {group.items.map((item) => (
                <li
                  key={item}
                  className="border-border/60 flex items-center gap-2.5 border-b py-3 text-[14px]"
                >
                  <Check
                    className="text-primary size-3.5 flex-none"
                    aria-hidden="true"
                  />
                  {item}
                </li>
              ))}
            </ul>
          </LandingReveal>
        ))}
      </div>
    </Band>
  );
}

/* -------------------------------------------------------------------------- */
/* FAQ                                                                        */
/* -------------------------------------------------------------------------- */

const FAQ: { q: string; a: string }[] = [
  {
    q: "Can an agent see data I can't?",
    a: "No. An agent acts under its owner's access, enforced by row-level security in the database. If you can't open a board, neither can your agent.",
  },
  {
    q: "Will an agent change my boards without asking?",
    a: "No. Agent changes arrive as proposals you confirm. Scheduled agents report and propose; applying is a human action.",
  },
  {
    q: "Whose AI is running this?",
    a: "Yours, if you want. Add your own Anthropic, OpenAI or Gemini key in Settings and your prompts run on your account. Keys are stored encrypted and never reach the browser.",
  },
  {
    q: "Can I use my own AI client instead?",
    a: "Yes. Monolith runs an MCP server with OAuth 2.1, so you can connect Claude or another MCP client and work the same boards from there.",
  },
  {
    q: "What's shipping and what isn't?",
    a: "Boards, views, automations with AI steps, dashboards, Ask, scheduled board agents and the MCP server are live. Named per-user agents replying in item threads are rolling out — that's what the marker on this page means.",
  },
  {
    q: "How do I get in?",
    a: "Access is invite-only while we onboard in waves. Request access below and we'll send an invite when your wave opens.",
  },
];

/** Native `<details>` — an accordion with no client JavaScript and no
 *  hydration cost on a page that is otherwise almost entirely static. */
export function FaqBand() {
  return (
    <Band id="faq">
      <LandingReveal>
        <SectionHead
          kicker="Questions"
          title="The things people actually ask."
          center
        />
      </LandingReveal>
      <div className="mx-auto mt-14 grid max-w-[900px] gap-3 md:grid-cols-2">
        {FAQ.map((entry, i) => (
          <LandingReveal key={entry.q} delayMs={i * 50}>
            <details className="bg-surface/60 border-border hover:border-border-hover h-full rounded-lg border px-5 py-4 transition-colors">
              <summary className="flex cursor-pointer list-none items-start gap-3 text-[15px] font-semibold">
                <span
                  className="bg-primary mt-[7px] size-1.5 flex-none rounded-full"
                  aria-hidden="true"
                />
                {entry.q}
              </summary>
              <p className="text-muted-foreground mt-3 pl-[18px] text-[14px] leading-relaxed">
                {entry.a}
              </p>
            </details>
          </LandingReveal>
        ))}
      </div>
    </Band>
  );
}

/* -------------------------------------------------------------------------- */
/* Closing CTA                                                                */
/* -------------------------------------------------------------------------- */

export function AccessBand({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <section id="waitlist" className="py-24 md:py-32">
      <Container>
        <LandingReveal className="mx-auto max-w-[640px] text-center">
          <Kicker>{signedIn ? "Your workspace" : "Request access"}</Kicker>
          <h2 className="mt-4 mb-4 text-3xl leading-[1.06] font-extrabold tracking-tight sm:text-4xl md:text-[46px]">
            {signedIn ? "Jump back in." : "Bring your team and its agents."}
          </h2>
          <p className="text-muted-foreground text-base leading-relaxed sm:text-lg">
            {signedIn
              ? "Everything your team ships, on one surface. Pick up right where you left off."
              : "We're onboarding teams in small batches. Add your email and we'll send an invite when your wave opens."}
          </p>

          {signedIn ? (
            <div className="mt-8">
              <Link
                href="/boards"
                className="bg-primary text-primary-foreground shadow-glow-primary ease-keystone inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-[15px] font-bold transition-[filter] duration-300 hover:brightness-110"
              >
                Open Monolith
                <ArrowRight className="size-4" />
              </Link>
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
  );
}
