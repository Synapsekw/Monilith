import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  Clock3,
  Command,
  FileText,
  Layers,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";
import { CREDITS_PER_SEAT, PRICING_TIERS, priceFor } from "@/lib/billing/tiers";
import { LandingNav } from "./landing-nav";
import { LandingWordmark } from "./landing-wordmark";
import { ProductGallery } from "./product-gallery";
import boardShot from "./captures/board.jpg";
import taskDetailsShot from "./captures/task-details.jpg";
import agentDockShot from "./captures/agent-dock.jpg";
import styles from "./editorial-landing.module.css";

/**
 * The public landing page — "Version 3 / Editorial, Charcoal + Cobalt", ported
 * from the approved design artifact. A Server Component: the only client
 * leaves are the nav's mobile toggle and the product gallery's tab state, so
 * every in-page interaction is 0 server round-trips (working agreement #5).
 *
 * Section order is the approved one: hero, capability strip, product tour,
 * the Monolith difference, agent access, AI features, pricing, FAQ, final CTA,
 * footer.
 *
 * Messaging rule (from the handoff): Monolith is designed for agents from the
 * start — external tools (Claude, GPT, compatible clients) OPERATE the platform
 * through MCP with the capabilities people have, inside authorized
 * permissions. That is distinct from the built-in scheduled board agents and
 * their proposal-review flow; neither is described as the other.
 *
 * Prices, credits and trial terms are read from `lib/billing/tiers` and the
 * pricing FAQ, never restated here, so the landing cannot drift from /pricing.
 */
export function EditorialLanding({ signedIn = false }: { signedIn?: boolean }) {
  const cta = signedIn
    ? { href: "/", label: "Open your workspace" }
    : { href: "/signup", label: "Start your trial" };

  return (
    <div id="top" className={`dark ${styles.page}`}>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <LandingNav signedIn={signedIn} />
      <main id="main">
        <Hero cta={cta} />
        <CapabilityStrip />
        <ProductTour />
        <WhyMonolith />
        <AgentAccess />
        <WorkFeatures />
        <Pricing cta={cta} />
        <Faq />
        <Closing cta={cta} />
      </main>
      <SiteFooter signedIn={signedIn} />
    </div>
  );
}

type Cta = { href: string; label: string };

function CtaLink({
  cta,
  light = false,
  children,
}: {
  cta: Cta;
  light?: boolean;
  children?: ReactNode;
}) {
  return (
    <Link
      href={cta.href}
      className={light ? `${styles.cta} ${styles.ctaLight}` : styles.cta}
    >
      {children ?? cta.label}
      <ArrowUpRight size={18} aria-hidden="true" />
    </Link>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className={styles.eyebrow}>
      <span aria-hidden="true" />
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Hero({ cta }: { cta: Cta }) {
  return (
    <>
      <section className={`${styles.hero} ${styles.wrap}`}>
        <div className={styles.heroComposition}>
          <div className={styles.heroCopy}>
            <div>
              <Eyebrow>MONOLITH / THE CONNECTED WORKSPACE</Eyebrow>
              <h1>
                Work, with
                <br />
                <span>everyone in it.</span>
              </h1>
            </div>
            <div className={styles.heroRight}>
              <p>
                Projects, people and the AI you choose. A shared place to plan,
                make decisions and move the work forward.
              </p>
              <div className={styles.heroActions}>
                <CtaLink cta={cta} />
                <a href="#product" className={styles.textLink}>
                  Explore the product
                  <ArrowDown size={16} aria-hidden="true" />
                </a>
              </div>
              <div className={styles.trialNote}>
                14-day Pulse trial <span aria-hidden="true" /> No seat minimum
              </div>
            </div>
          </div>

          {/* The unframed, full-width real product capture. */}
          <div className={styles.stage} id="demo">
            <div className={styles.captureStage}>
              <Image
                src={boardShot}
                alt="Monolith board in dark mode: grouped items with stage, deal size, priority and close-date columns"
                sizes="(max-width: 780px) 145vw, 1220px"
                quality={85}
                priority
              />
            </div>
          </div>
          <div className={styles.editorialIndex} aria-hidden="true">
            <span>01 / PLAN TOGETHER</span>
            <span>02 / BRING YOUR AGENTS</span>
            <span>03 / MOVE WORK FORWARD</span>
          </div>
        </div>
        <div className={styles.heroUnder}>
          <span>Works with Claude, GPT and other compatible AI tools.</span>
          <span>
            Human capabilities. Agent access.
            <ArrowDown size={14} aria-hidden="true" />
          </span>
        </div>
      </section>
    </>
  );
}

function CapabilityStrip() {
  return (
    <div className={styles.capabilityStrip}>
      <div className={styles.wrap}>
        <span>
          <Layers size={18} aria-hidden="true" />
          Projects and teamwork
        </span>
        <span>
          <Bot size={18} aria-hidden="true" />
          Full agent access through MCP
        </span>
        <span>
          <ShieldCheck size={18} aria-hidden="true" />
          Your permissions, everywhere
        </span>
      </div>
    </div>
  );
}

function ProductTour() {
  const notes = [
    {
      n: "01",
      h: "A plan that fits your team.",
      p: "Custom fields, statuses and templates give your work the structure it needs. Switch between table, kanban, calendar and timeline views.",
    },
    {
      n: "02",
      h: "The details stay with the task.",
      p: "Keep discussions, attachments and decisions close to the work they belong to.",
    },
    {
      n: "03",
      h: "The bigger picture stays visible.",
      p: "Connect boards to goals, portfolios and workload without rebuilding the story.",
    },
  ];
  return (
    <section id="product" className={styles.sectionSpace}>
      <div className={styles.wrap}>
        <div className={styles.sectionHeading}>
          <div>
            <Eyebrow>01 / KEEP THE WORK CONNECTED</Eyebrow>
            <h2>
              The big picture.
              <br />
              And every little detail.
            </h2>
          </div>
          <p>
            From the board to the item to the conversation. Your team works with
            the same information, wherever they pick things up.
          </p>
        </div>
        <ProductGallery />
        <div className={styles.featureNotes}>
          {notes.map((x) => (
            <div key={x.n}>
              <span>{x.n}</span>
              <h3>{x.h}</h3>
              <p>{x.p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WhyMonolith() {
  const items = [
    {
      n: "01",
      h: "Your AI gets operating access.",
      p: "External agents can take the same actions as people through MCP. Work from your preferred tool.",
    },
    {
      n: "02",
      h: "The foundations come together.",
      p: "Boards, automations, dashboards, portfolios, workload and time tracking are included in Core.",
    },
    {
      n: "03",
      h: "Every seat counts. Exactly once.",
      p: "No seat minimum and no seat buckets. Pay for the seats your team actually uses.",
    },
  ];
  return (
    <section id="why" className={styles.whySection}>
      <div className={`${styles.wrap} ${styles.whyLayout}`}>
        <div>
          <Eyebrow>THE MONOLITH DIFFERENCE</Eyebrow>
          <h2>
            Built around
            <br />
            the way you work.
          </h2>
          <p>
            A capable work platform, open to the AI you choose, with pricing
            that follows your actual team.
          </p>
        </div>
        <div className={styles.whyList}>
          {items.map((x) => (
            <div key={x.n}>
              <span>{x.n}</span>
              <div>
                <h3>{x.h}</h3>
                <p>{x.p}</p>
              </div>
              <ArrowUpRight size={19} aria-hidden="true" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AgentAccess() {
  const details = [
    {
      n: "01",
      h: "Delegate a complete workflow.",
      p: "Create a project, assign owners, update tasks and post the next update — from the AI tool you already use.",
    },
    {
      n: "02",
      h: "Keep the team in the loop.",
      p: "Agent-created work lives in the same boards and threads your teammates use. Everyone can pick up from there.",
    },
    {
      n: "03",
      h: "Keep access under control.",
      p: "Agents operate within their authorized permissions. The workspace remains the common source of truth.",
    },
  ];
  return (
    <section
      id="agents"
      className={`${styles.agentSection} ${styles.sectionSpace}`}
    >
      <div className={styles.wrap}>
        <div className={styles.sectionHeading}>
          <div>
            <Eyebrow>02 / GIVE YOUR AI A WAY IN</Eyebrow>
            <h2>
              You can run the workspace.
              <br />
              <span>So can your agents.</span>
            </h2>
          </div>
          <p>
            Monolith is designed for agents from the start. External AI tools
            can operate the platform through MCP, with the capabilities
            available to people.
          </p>
        </div>
        <div className={styles.accessLayout}>
          <div className={styles.accessPaths}>
            <div className={styles.accessHeading}>
              <span>CHOOSE HOW YOU WORK</span>
              <ArrowDown size={15} aria-hidden="true" />
            </div>
            <div className={styles.accessClients}>
              <div>
                <span className={styles.accessSymbol}>
                  <Command size={24} aria-hidden="true" />
                </span>
                <h3>Your team</h3>
                <p>Through the interface</p>
              </div>
              <div>
                <span className={styles.accessSymbol}>
                  <Bot size={24} aria-hidden="true" />
                </span>
                <h3>Your agents</h3>
                <p>Through MCP</p>
              </div>
            </div>
            <div className={styles.pathLines} aria-hidden="true">
              <span />
              <span />
            </div>
            <div className={styles.destination}>
              <LandingWordmark />
              <span>Shared work. Shared context.</span>
            </div>
            <div className={styles.clientNames}>
              <span>Claude</span>
              <span>GPT</span>
              <span>Other compatible tools</span>
            </div>
          </div>
          <div className={styles.accessDetails}>
            {details.map((item) => (
              <div key={item.n}>
                <span>{item.n}</span>
                <div>
                  <h3>{item.h}</h3>
                  <p>{item.p}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function WorkFeatures() {
  return (
    <section className={styles.sectionSpace}>
      <div className={styles.wrap}>
        <div className={styles.sectionHeading}>
          <div>
            <Eyebrow>03 / MAKE FOLLOW-THROUGH EASIER</Eyebrow>
            <h2>
              Intelligence,
              <br />
              close to the work.
            </h2>
          </div>
          <p>
            Ask a question, find the context or get help with the next step. AI
            is part of the workspace your team already uses.
          </p>
        </div>
        <div className={styles.featureLayout}>
          <article className={styles.feature}>
            <div className={`${styles.featureCapture} ${styles.dockCrop}`}>
              <Image
                src={agentDockShot}
                alt="Monolith agent dock beside a board, with workspace questions and a prompt field"
                sizes="(max-width: 580px) 228vw, 1300px"
                quality={85}
              />
            </div>
            <div className={styles.panelCopy}>
              <Bot size={22} aria-hidden="true" />
              <h3>Ask from where you work.</h3>
              <p>
                The agent dock sits beside the board. Ask what’s overdue, who’s
                overloaded or what shipped this week.
              </p>
            </div>
          </article>
          <article className={styles.feature}>
            <div className={`${styles.featureCapture} ${styles.detailCrop}`}>
              <Image
                src={taskDetailsShot}
                alt="Monolith item assistance: suggest subtasks, propose a status and find similar items"
                sizes="(max-width: 580px) 200vw, 1150px"
                quality={85}
              />
            </div>
            <div className={styles.panelCopy}>
              <FileText size={22} aria-hidden="true" />
              <h3>Make the next step easier.</h3>
              <p>
                Suggest subtasks, propose a status and find related items from
                inside the item you’re working on.
              </p>
            </div>
          </article>
        </div>
        <div className={styles.followNotes}>
          <div>
            <Clock3 size={22} aria-hidden="true" />
            <h3>Keep a regular rhythm.</h3>
            <p>
              Scheduled board agents check the work and propose changes for your
              review.
            </p>
          </div>
          <div>
            <Layers size={22} aria-hidden="true" />
            <h3>See across the team.</h3>
            <p>
              Dashboards, goals, workload and time tracking bring progress into
              one view.
            </p>
          </div>
          <div>
            <MessageSquare size={22} aria-hidden="true" />
            <h3>Keep the context together.</h3>
            <p>
              Item updates, mentions and files keep decisions attached to the
              work.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

const PLAN_COPY: Record<
  (typeof PRICING_TIERS)[number]["id"],
  { blurb: string; includes: string; features: string[]; foot: string }
> = {
  core: {
    blurb: "The connected work platform.",
    includes: "THE FOUNDATION",
    features: [
      "Unlimited boards and workspaces",
      "Table, kanban, calendar and timeline",
      "Automations and dashboards",
      "Goals, portfolios and workload",
      "Time tracking and guest sharing",
    ],
    foot: "No seat minimum. AI not included.",
  },
  pulse: {
    blurb: "The platform, with built-in intelligence.",
    includes: "EVERYTHING IN CORE, PLUS",
    features: [
      "Ask AI across your workspace",
      "Scheduled agents and briefings",
      "AI board and dashboard generation",
      "Semantic search",
      `${CREDITS_PER_SEAT} AI credits per seat, pooled`,
    ],
    foot: "One shared AI credit pool for your team.",
  },
  enterprise: {
    blurb: "For teams with specific requirements.",
    includes: "EVERYTHING IN PULSE, PLUS",
    features: [
      "Custom AI credit ceiling",
      "Single sign-on",
      "Your own model keys, by arrangement",
      "Priority support",
    ],
    foot: "A plan shaped around your organization.",
  },
};

function Pricing({ cta }: { cta: Cta }) {
  return (
    <section className={styles.sectionSpace} id="pricing">
      <div className={styles.wrap}>
        <div className={styles.pricingHeading}>
          <Eyebrow>A PLAN FOR YOUR TEAM</Eyebrow>
          <h2>
            Start with the work.
            <br />
            Add the intelligence.
          </h2>
          <p>Every new workspace starts with a 14-day trial of Pulse.</p>
          <span className={styles.billingLabel}>
            Prices below are per user, per month, billed annually.
          </span>
        </div>
        <div className={styles.pricingGrid}>
          {PRICING_TIERS.map((tier) => {
            const copy = PLAN_COPY[tier.id];
            const price = priceFor(tier, "annual");
            const highlight = tier.highlight;
            return (
              <article
                key={tier.id}
                className={
                  highlight ? `${styles.plan} ${styles.pulsePlan}` : styles.plan
                }
              >
                {highlight ? (
                  <div className={styles.planTop}>
                    <span className={styles.planName}>{tier.name}</span>
                    <span className={styles.planBadge}>WITH AI</span>
                  </div>
                ) : (
                  <span className={styles.planName}>{tier.name}</span>
                )}
                <p>{copy.blurb}</p>
                {price === null ? (
                  <div className={`${styles.price} ${styles.customPrice}`}>
                    Let’s talk.
                  </div>
                ) : (
                  <div className={styles.price}>
                    ${price}
                    <span>/ user / month</span>
                  </div>
                )}
                {price === null ? (
                  <Link href="/pricing" className={styles.planButton}>
                    Explore Enterprise
                    <ArrowUpRight size={17} aria-hidden="true" />
                  </Link>
                ) : highlight ? (
                  <CtaLink cta={cta} />
                ) : (
                  <Link href={cta.href} className={styles.planButton}>
                    {cta.label}
                    <ArrowUpRight size={17} aria-hidden="true" />
                  </Link>
                )}
                <div className={styles.planIncludes}>{copy.includes}</div>
                <ul>
                  {copy.features.map((x) => (
                    <li key={x}>
                      <Check size={14} aria-hidden="true" />
                      {x}
                    </li>
                  ))}
                </ul>
                <div className={styles.planFoot}>{copy.foot}</div>
              </article>
            );
          })}
        </div>
        <div className={styles.pricingNote}>
          <span>
            Card required for the trial. Switch plans or cancel during the
            trial.
          </span>
          <Link href="/pricing">
            Compare all plan details
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}

export const LANDING_FAQS: { q: string; a: string }[] = [
  {
    q: "What can an external AI tool do in Monolith?",
    a: "Through MCP, compatible external AI tools can operate the platform with the capabilities available to people: creating projects, assigning work, updating tasks and more. Actions stay within the access you authorize.",
  },
  {
    q: "Do I have to use AI to use Monolith?",
    a: "No. Core is a complete work platform without AI: boards, views, automations, dashboards, goals, portfolios, workload and time tracking. Your team can work entirely through the interface.",
  },
  {
    q: "How are built-in agents different from external AI tools?",
    a: "Built-in board agents work inside Monolith on a schedule and propose changes for your review. External tools connect through MCP and can operate the platform using their authorized access. Their interaction and confirmation flow depends on the tool you use.",
  },
  {
    q: "Which features are available today?",
    a: "Boards, views, automations with AI steps, dashboards, workspace AI, scheduled board agents and MCP are live. Named personal agents replying in item threads are rolling out.",
  },
  {
    q: "How does the trial work?",
    a: "New workspaces get 14 days of Pulse. A payment card is required. You can switch to Core or cancel during the trial; otherwise, the subscription continues on the selected plan.",
  },
  {
    q: "What happens when our AI credits run out?",
    a: "Built-in AI features pause until the monthly pool resets. The rest of Monolith stays available, including boards, dashboards and standard automations. Updating a task does not depend on having AI credits.",
  },
];

/**
 * FAQ on native `<details name>`: no JavaScript, keyboard and screen-reader
 * behaviour for free, and the shared `name` makes the group exclusive (one
 * open at a time) the way the artifact's accordion behaved.
 */
function Faq() {
  return (
    <section className={`${styles.faqSection} ${styles.wrap}`}>
      <div>
        <Eyebrow>A FEW MORE THINGS</Eyebrow>
        <h2>
          Good questions.
          <br />
          Straight answers.
        </h2>
      </div>
      <div className={styles.faqs}>
        {LANDING_FAQS.map((f) => (
          <details key={f.q} className={styles.faqItem} name="landing-faq">
            <summary>
              {f.q}
              <ChevronDown size={16} aria-hidden="true" />
            </summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function Closing({ cta }: { cta: Cta }) {
  return (
    <section className={styles.closingSection}>
      <div className={`${styles.wrap} ${styles.closingLayout}`}>
        <div>
          <Eyebrow>YOUR NEXT PROJECT STARTS HERE</Eyebrow>
          <h2>
            Bring your team.
            <br />
            Bring your AI.
          </h2>
        </div>
        <div>
          <p>
            One place to plan the work,
            <br />
            share the context and move it forward.
          </p>
          <CtaLink cta={cta} light>
            {cta.href === "/signup" ? "Create your workspace" : cta.label}
          </CtaLink>
          <span>14-day Pulse trial · No seat minimum</span>
        </div>
      </div>
    </section>
  );
}

function SiteFooter({ signedIn }: { signedIn: boolean }) {
  return (
    <footer className={`${styles.footer} ${styles.wrap}`}>
      <div className={styles.footerTop}>
        <div>
          <a href="#top" aria-label="Monolith home">
            <LandingWordmark />
          </a>
          <p>
            The workspace for people
            <br />
            and the AI they choose.
          </p>
        </div>
        <div className={styles.footerLinks}>
          <div>
            <span>PLATFORM</span>
            <a href="#product">Product</a>
            <a href="#agents">Agent access</a>
            <a href="#pricing">Pricing</a>
          </div>
          <div>
            <span>EXPLORE</span>
            <Link href="/updates">
              Product updates
              <ArrowUpRight size={12} aria-hidden="true" />
            </Link>
            {signedIn ? (
              <Link href="/">
                Enter app
                <ArrowUpRight size={12} aria-hidden="true" />
              </Link>
            ) : (
              <Link href="/login">
                Sign in
                <ArrowUpRight size={12} aria-hidden="true" />
              </Link>
            )}
            <a href="#demo">Explore the workspace</a>
          </div>
        </div>
      </div>
      <div className={styles.footerBottom}>
        <span>© 2026 Monolith</span>
        <a href="#top">Back to top ↑</a>
      </div>
    </footer>
  );
}
