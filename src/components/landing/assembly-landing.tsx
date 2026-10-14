/* The approved Assembly uses local, already compressed product captures at their
 * original quality. Native images also let the screen viewer reuse the same URL. */
/* eslint-disable @next/next/no-img-element */
import { ArrowDown, ArrowUp, ArrowUpRight } from "lucide-react";
import { AssemblyBrand } from "./assembly-brand";
import { AssemblyEffects } from "./assembly-effects";
import "./assembly-fonts.css";
import "./assembly.css";

/** Substantive marketing content stays on the server; effects load after paint. */
export function AssemblyLanding({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <div
      className="assembly-landing assembly"
      data-experience="assembly"
      data-signed-in={signedIn ? "true" : "false"}
    >
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="progress-line" aria-hidden="true"></div>
      <header className="site-header">
        <div className="wrap">
          <a href="#top" aria-label="Monolith home">
            <AssemblyBrand />
          </a>
          <nav className="header-links" aria-label="Main navigation">
            <a href="#product">The workspace</a>
            <a href="#agents">People + agents</a>
            <a href="#pricing">Pricing</a>
          </nav>
          <div className="header-actions">
            <a className="login" href={signedIn ? "/" : "/login"}>
              {signedIn ? "Enter app" : "Log in"}
            </a>
            <a
              className="button small outline"
              href={signedIn ? "/" : "/signup"}
            >
              {signedIn ? "Enter app" : "Start your trial"}{" "}
              <span className="arrow" aria-hidden="true">
                <ArrowUpRight className="landing-arrow" aria-hidden="true" />
              </span>
            </a>
            <button
              className="menu-toggle"
              aria-label="Open navigation"
              aria-expanded="false"
              aria-controls="mobile-nav"
            >
              ☰
            </button>
          </div>
        </div>
      </header>
      <nav
        className="mobile-nav"
        id="mobile-nav"
        aria-label="Mobile navigation"
      >
        <a href="#product">The workspace</a>
        <a href="#agents">People + agents</a>
        <a href="#pricing">Pricing</a>
        <a href={signedIn ? "/" : "/login"}>
          {signedIn ? "Enter app" : "Log in"}{" "}
          <ArrowUpRight className="landing-arrow" aria-hidden="true" />
        </a>
      </nav>
      <main id="main">
        <section className="assembly-intro" id="top">
          <div className="hero-a">
            <div className="wrap">
              <div className="hero-copy">
                <div className="eyebrow">Every part has a purpose</div>
                <h1>
                  Good work.
                  <br />
                  Coming
                  <br />
                  <span>together.</span>
                </h1>
                <p className="intro">
                  Projects, people and the AI you choose.
                  <br />A shared foundation for whatever comes next.
                </p>
                <div className="actions">
                  <a className="button" href={signedIn ? "/" : "/signup"}>
                    {signedIn ? "Enter app" : "Start your trial"}{" "}
                    <span className="arrow" aria-hidden="true">
                      <ArrowUpRight
                        className="landing-arrow"
                        aria-hidden="true"
                      />
                    </span>
                  </a>
                  <a className="text-link" href="#product">
                    Watch it take shape{" "}
                    <span aria-hidden="true">
                      <ArrowDown className="landing-arrow" aria-hidden="true" />
                    </span>
                  </a>
                </div>
                <p className="trial-note">
                  14-day Pulse trial · No seat minimum
                </p>
              </div>
            </div>
            <div className="assembly-art-stage">
              <div className="hero-art" data-canvas-zone="">
                <canvas
                  id="assembly-canvas"
                  aria-label="Four notched graphite pieces interlock into a monolith as you scroll. Drag to turn the joint."
                  role="img"
                ></canvas>
                <span className="art-label mono">
                  Precision in every connection.
                </span>
                <div className="hero-workspace" aria-hidden="true">
                  <div className="workspace-reveal-label">
                    <span className="mono">
                      The foundation becomes the workspace.
                    </span>
                    <span aria-hidden="true">
                      <ArrowUpRight
                        className="landing-arrow"
                        aria-hidden="true"
                      />
                    </span>
                  </div>
                  <img
                    src="/landing/assembly/board-blue.jpg"
                    width="1625"
                    height="912"
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                  <div className="workspace-reveal-footer">
                    <span>Everything connected.</span>
                    <span>Everyone in the picture.</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
        <div className="signal-strip">
          <div className="wrap">
            <span>
              <b>One connected workspace.</b>
            </span>
            <span>Your team. Your chosen AI.</span>
            <span>Shared work. Authorized access.</span>
          </div>
        </div>
        <section
          className="assembly-story"
          id="product"
          aria-label="Explore the product in three chapters"
        >
          <div className="story-pin wrap">
            <div className="story-copy">
              <div className="eyebrow">01 / The work takes shape</div>
              <h2 className="section-title">
                Everything
                <br />
                in its
                <br />
                <em>right place.</em>
              </h2>
              <p className="section-copy">
                Start with the big picture. Get close to the details. Bring the
                right intelligence into the moment.
              </p>
              <div className="chapter-list">
                <button
                  className="chapter"
                  data-chapter="0"
                  aria-pressed="true"
                >
                  <span className="mono">01</span>
                  <strong>Give work a shape.</strong>
                  <span>
                    Boards, owners and priorities make the next step visible.
                  </span>
                </button>
                <button
                  className="chapter"
                  data-chapter="1"
                  aria-pressed="false"
                >
                  <span className="mono">02</span>
                  <strong>Keep the context close.</strong>
                  <span>
                    Conversations, files and decisions stay with the task.
                  </span>
                </button>
                <button
                  className="chapter"
                  data-chapter="2"
                  aria-pressed="false"
                >
                  <span className="mono">03</span>
                  <strong>Bring your AI into it.</strong>
                  <span>
                    Ask questions from beside the work, with its context in
                    view.
                  </span>
                </button>
              </div>
            </div>
            <div className="screen-stage" data-tilt="">
              <div className="screen-glow"></div>
              <div className="screen-stack">
                <div className="screen active" data-screen="0">
                  <img
                    src="/landing/assembly/board-blue.jpg"
                    width="1625"
                    height="912"
                    alt="Monolith board with grouped tasks, owners and status columns"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <div className="screen next" data-screen="1">
                  <img
                    src="/landing/assembly/task-details-blue.jpg"
                    width="1625"
                    height="912"
                    alt="Monolith task detail panel with AI assist controls and item metadata"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <div className="screen next" data-screen="2">
                  <img
                    src="/landing/assembly/agent-dock-blue.jpg"
                    width="1625"
                    height="912"
                    alt="Monolith agent dock alongside the board"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              </div>
              <div className="screen-caption">
                <span data-screen-index="">01 / THE BOARD</span>
                <span data-screen-caption="">
                  The big picture, without losing the details.
                </span>
              </div>
              <button className="screen-expand" data-expand-screen="">
                Explore the screen{" "}
                <span aria-hidden="true">
                  <ArrowUpRight className="landing-arrow" aria-hidden="true" />
                </span>
              </button>
            </div>
          </div>
        </section>
        <section className="manifesto">
          <div className="wrap">
            <div className="eyebrow reveal">Designed to fit together</div>
            <h2 className="reveal" data-word-reveal="">
              <span data-word="">The task.</span>{" "}
              <span data-word="">The conversation.</span>{" "}
              <span data-word="">The decision.</span>
              <br />
              <span data-word="">Every part.</span>{" "}
              <span data-word="">One shared story.</span>
            </h2>
            <p className="section-copy reveal">
              The connection is the point. Your views, your updates and your
              next steps belong to the same shared picture.
            </p>
          </div>
        </section>
        <section className="section" id="agents">
          <div className="wrap agent-grid">
            <div className="reveal">
              <div className="eyebrow">02 / More ways to move forward</div>
              <h2 className="section-title">
                Your team can.
                <br />
                <em>
                  Your agents
                  <br />
                  can, too.
                </em>
              </h2>
              <p className="section-copy">
                Monolith is built for people and the AI tools they choose.
                Through MCP, compatible external agents can create projects,
                assign work and update tasks within the access you authorize.
              </p>
              <div className="agent-mode" aria-label="Explore how work happens">
                <button data-agent-mode="human" aria-pressed="true">
                  Through your team
                </button>
                <button data-agent-mode="agent" aria-pressed="false">
                  Through your agent
                </button>
              </div>
              <p className="agent-footnote">
                External MCP actions follow their authorized permissions.
                Built-in scheduled board agents use a separate
                proposal-and-review flow.
              </p>
            </div>
            <div className="agent-visual spotlight reveal">
              <div className="agent-top">
                <span className="mono">One workspace. Shared context.</span>
                <div className="agent-orb" aria-hidden="true">
                  ✦
                </div>
              </div>
              <div aria-live="polite">
                <p className="agent-request" data-agent-request="">
                  “Let&apos;s get the next project moving.”
                </p>
                <ul className="event-list">
                  <li className="lit">
                    <span className="event-dot"></span>
                    <span data-event-text="0">Create a project board</span>
                    <small data-event-role="0">TEAM</small>
                  </li>
                  <li className="lit">
                    <span className="event-dot"></span>
                    <span data-event-text="1">
                      Assign owners and priorities
                    </span>
                    <small data-event-role="1">TEAM</small>
                  </li>
                  <li className="lit">
                    <span className="event-dot"></span>
                    <span data-event-text="2">Share the next update</span>
                    <small data-event-role="2">TEAM</small>
                  </li>
                </ul>
                <p className="agent-footnote" data-agent-foot="">
                  One person starts. Everyone can pick up the thread.
                </p>
              </div>
              <p className="agent-footnote">
                Illustrative workflow · no live actions
              </p>
            </div>
          </div>
        </section>
        <section className="section" style={{ paddingTop: "25px" }}>
          <div className="wrap">
            <div className="section-top reveal">
              <div>
                <div className="eyebrow">03 / Room for the whole picture</div>
                <h2 className="section-title">
                  Built for the work.
                  <br />
                  <em>And everything around it.</em>
                </h2>
              </div>
              <p className="section-copy">
                A strong foundation, from the daily task to the direction your
                team is heading.
              </p>
            </div>
            <div className="capability-list">
              <article className="capability spotlight reveal">
                <div className="mono">01 / Perspective</div>
                <h3>Same work. A different view.</h3>
                <p>
                  Table, kanban, calendar and timeline views let your team look
                  at the same work in the way that makes sense.
                </p>
              </article>
              <article className="capability spotlight reveal">
                <div className="mono">02 / Follow-through</div>
                <h3>Keep the routine moving.</h3>
                <p>
                  Automations help with repeatable steps. Built-in scheduled
                  board agents propose changes for your review.
                </p>
              </article>
              <article className="capability spotlight reveal">
                <div className="mono">03 / Direction</div>
                <h3>See beyond the board.</h3>
                <p>
                  Connect the work to goals, portfolios and dashboards. Keep the
                  bigger picture close enough to act on.
                </p>
              </article>
              <article className="capability spotlight reveal">
                <div className="mono">04 / Balance</div>
                <h3>Make room for your people.</h3>
                <p>
                  Workload and time tracking make capacity and effort visible
                  alongside the projects they belong to.
                </p>
              </article>
            </div>
          </div>
        </section>
        <section className="section pricing-section" id="pricing">
          <div className="wrap">
            <div className="section-top reveal">
              <div>
                <div className="eyebrow">A plan that fits your team</div>
                <h2 className="section-title">
                  Start with the work.
                  <br />
                  <em>Add the intelligence.</em>
                </h2>
              </div>
              <div className="billing-toggle" aria-label="Billing cadence">
                <button data-billing="annual" aria-pressed="true">
                  Billed yearly
                </button>
                <button data-billing="monthly" aria-pressed="false">
                  Billed monthly
                </button>
              </div>
            </div>
            <div className="plans">
              <article className="plan spotlight reveal">
                <div className="plan-label">
                  Core <span className="mono">The foundation</span>
                </div>
                <p className="plan-tagline">The connected work platform.</p>
                <div className="price">
                  $<span data-price="core">10</span>
                </div>
                <p className="price-term">
                  per user / month
                  <br />
                  <span data-billing-note="">Billed annually</span>
                </p>
                <a className="button outline" href={signedIn ? "/" : "/signup"}>
                  {signedIn ? "Enter app" : "Start your trial"}{" "}
                  <span className="arrow" aria-hidden="true">
                    <ArrowUpRight
                      className="landing-arrow"
                      aria-hidden="true"
                    />
                  </span>
                </a>
                <ul>
                  <li>Unlimited boards and workspaces</li>
                  <li>Table, kanban, calendar and timeline</li>
                  <li>Automations, dashboards and reports</li>
                  <li>Goals, portfolios and workload</li>
                  <li>Time tracking and guest sharing</li>
                  <li>No seat minimum. AI not included.</li>
                </ul>
              </article>
              <article className="plan featured spotlight reveal">
                <div className="plan-label">
                  Pulse <span className="mono">With intelligence</span>
                </div>
                <p className="plan-tagline">The platform, with built-in AI.</p>
                <div className="price">
                  $<span data-price="pulse">24</span>
                </div>
                <p className="price-term">
                  per user / month
                  <br />
                  <span data-billing-note="">Billed annually</span>
                </p>
                <a className="button" href={signedIn ? "/" : "/signup"}>
                  {signedIn ? "Enter app" : "Start your trial"}{" "}
                  <span className="arrow" aria-hidden="true">
                    <ArrowUpRight
                      className="landing-arrow"
                      aria-hidden="true"
                    />
                  </span>
                </a>
                <ul>
                  <li>Everything in Core</li>
                  <li>Ask AI across your workspace</li>
                  <li>Personal agents and briefings</li>
                  <li>AI generation and semantic search</li>
                  <li>500 pooled AI credits per seat</li>
                  <li>Scheduled agents and proposals</li>
                </ul>
              </article>
              <article className="plan spotlight reveal">
                <div className="plan-label">Enterprise</div>
                <p className="plan-tagline">For your specific requirements.</p>
                <div className="price text">Let&apos;s talk.</div>
                <p className="price-term">
                  A plan shaped around
                  <br />
                  your organization
                </p>
                <a
                  className="button outline"
                  href="mailto:info@synapse-solutions.ai?subject=Monolith%20Enterprise"
                >
                  Discuss your team{" "}
                  <span className="arrow" aria-hidden="true">
                    <ArrowUpRight
                      className="landing-arrow"
                      aria-hidden="true"
                    />
                  </span>
                </a>
                <ul>
                  <li>Everything in Pulse</li>
                  <li>Custom AI credit ceiling</li>
                  <li>Single sign-on</li>
                  <li>Model keys by arrangement</li>
                  <li>Priority support</li>
                </ul>
              </article>
            </div>
            <p className="pricing-note">
              Every new workspace starts with a 14-day trial of Pulse. Card
              required. Switch plans or cancel during the trial.
              <br />
              Prices in USD. No seat minimum.{" "}
              <a className="text-link" href="/pricing">
                Compare all plan details{" "}
                <ArrowUpRight className="landing-arrow" aria-hidden="true" />
              </a>
            </p>
          </div>
        </section>
        <section className="section" id="questions">
          <div className="wrap faq-layout">
            <div className="reveal">
              <div className="eyebrow">A little clarity</div>
              <h2 className="section-title">
                Good questions.
                <br />
                <em>Straight answers.</em>
              </h2>
            </div>
            <div className="faq-list reveal">
              <details>
                <summary>What can an external AI tool do in Monolith?</summary>
                <p>
                  Compatible tools can operate the workspace through MCP,
                  including creating projects, assigning owners and updating
                  tasks. Their actions are limited by the access you authorize.
                </p>
              </details>
              <details>
                <summary>Do we need AI to use Monolith?</summary>
                <p>
                  No. Core includes the work platform without AI: boards, views,
                  automations, dashboards, goals, portfolios, workload and time
                  tracking. Pulse adds built-in intelligence.
                </p>
              </details>
              <details>
                <summary>Are built-in and external agents the same?</summary>
                <p>
                  No. Built-in scheduled board agents can propose changes for
                  your review. External tools connect through MCP and take
                  actions within the permissions you authorize; they do not all
                  pass through that proposal-review flow.
                </p>
              </details>
              <details>
                <summary>How does the trial work?</summary>
                <p>
                  New workspaces start with a 14-day trial of Pulse. A card is
                  required. You can switch plans or cancel during the trial, and
                  there is no minimum number of seats.
                </p>
              </details>
              <details>
                <summary>Does the product walkthrough use our data?</summary>
                <p>
                  No. The product walkthrough uses illustrative example data and
                  runs entirely in your browser. It does not connect to your
                  workspace or run live AI.
                </p>
              </details>
            </div>
          </div>
        </section>
        <section className="closing">
          <div className="wrap">
            <div className="eyebrow reveal">The next chapter is yours</div>
            <h2 className="reveal">
              Bring it
              <br />
              <span className="accent">all together.</span>
            </h2>
            <p className="section-copy reveal">
              One place for your people, your projects
              <br />
              and the AI you choose.
            </p>
            <div className="actions reveal">
              <a className="button" href={signedIn ? "/" : "/signup"}>
                {signedIn ? "Enter app" : "Start your trial"}{" "}
                <span className="arrow" aria-hidden="true">
                  <ArrowUpRight className="landing-arrow" aria-hidden="true" />
                </span>
              </a>
              <a className="text-link" href="#top">
                Experience it again{" "}
                <ArrowUp className="landing-arrow" aria-hidden="true" />
              </a>
            </div>
            <p className="trial-note">
              14-day Pulse trial · Card required · No seat minimum
            </p>
          </div>
        </section>
        <dialog className="screen-dialog" aria-label="Monolith product screen">
          <div className="screen-dialog-bar">
            <span className="mono" data-dialog-title="">
              Monolith / The board
            </span>
            <button data-close-screen="" aria-label="Close product screen">
              Close ×
            </button>
          </div>
          <img
            data-dialog-image=""
            alt="Monolith product screen"
            loading="lazy"
            decoding="async"
          />
          <p>Product capture · Explore the details</p>
        </dialog>
      </main>
      <footer className="site-footer">
        <div className="wrap">
          <div className="footer-row">
            <div>
              <a href="#top" aria-label="Monolith home">
                <AssemblyBrand />
              </a>
              <p>
                The workspace for people
                <br />
                and the AI they choose.
              </p>
            </div>
            <div className="footer-links">
              <div>
                <span className="mono">Explore</span>
                <a href="#product">The workspace</a>
                <a href="#agents">People + agents</a>
                <a href="#pricing">Pricing</a>
              </div>
              <div>
                <span className="mono">Next steps</span>
                <a href={signedIn ? "/" : "/signup"}>
                  {signedIn ? "Enter app" : "Start your trial"}{" "}
                  <ArrowUpRight className="landing-arrow" aria-hidden="true" />
                </a>
                <a href="/updates">
                  Product updates{" "}
                  <ArrowUpRight className="landing-arrow" aria-hidden="true" />
                </a>
                <a href="#top">
                  Back to top{" "}
                  <ArrowUp className="landing-arrow" aria-hidden="true" />
                </a>
              </div>
            </div>
          </div>
          <div className="big-wordmark" aria-hidden="true">
            <AssemblyBrand />
          </div>
          <div className="footer-bottom">
            <span>© 2026 Monolith · By Synapse Solutions</span>
            <span>Work, with everyone in it.</span>
          </div>
        </div>
      </footer>
      <button
        className="motion-control"
        aria-pressed="false"
        aria-label="Pause motion"
        data-motion=""
      >
        <span aria-hidden="true">Ⅱ</span>
        <span data-motion-label="">Pause motion</span>
      </button>
      <AssemblyEffects signedIn={signedIn} />
    </div>
  );
}
