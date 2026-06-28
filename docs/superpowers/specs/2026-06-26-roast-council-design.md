---
type: spec
status: approved
date: 2026-06-26
slug: roast-council
tags: [spec, tooling, orchestration, decision-making, council]
related:
  - "[[2026-06-21-whats-next-skill-design]]"
  - "[[parallel-agent-dispatch]]"
---

# `/roast` — adversarial decision council command

## Purpose

A `/`-command that pulls Claude out of agreement mode (sycophancy) and **stress-tests an idea or
decision before any work is committed**. Instead of one model judging — and talking itself into
agreement — it spins up a council of adversarial persona sub-agents in parallel, each attacking the
input from a different angle, then a **separate Judge** synthesizes all of their findings into one
verdict. Modeled on Nate Herk's "roast" skill, adapted to this repo's command + parallel-dispatch
conventions and generalized to cover technical/product decisions as well as business ideas.

The core principle (from Nate, and reinforced by this repo's own anti-sycophancy posture): **the
worker does not get to grade itself.** The personas generate; a different agent judges.

## Location & invocation

- File: `.claude/commands/roast.md` — sibling to `.claude/commands/whats-next.md`.
- Invoked as `/roast <your idea or decision>`.
- **No worktree / no precondition on checkout.** This is repo tooling (a prose orchestration
  command), not shippable app source — the four gates (`typecheck/lint/test/build`) do not compile
  it. It is added directly on `develop` in the main checkout, in the same class as the other
  command files. It dispatches read/research sub-agents but **writes no files** itself.

## Mode-aware behaviour

`/roast` detects, from the input, whether it is judging:

- **`idea` mode** — a business/product/monetization idea ("a $9/mo tool that turns a transcript
  into LinkedIn posts", "should we charge for X").
- **`technical` mode** — an engineering/architecture/process/tooling decision ("adopt library X",
  "is this migration plan sound", "split this service").

The command prints the detected mode in one line and the user can override it in their reply
("treat this as technical"). Mode selects the intake questions and the council roster.

## Pipeline

The command MUST create a TodoWrite item per stage and work them in order.

### 1. Detect mode

Classify the input as `idea` or `technical`. State the call in one line; honor a user override.

### 2. Intake gate — up to 3 mode-aware questions

Ask **at most 3** sharp clarifying questions via `AskUserQuestion`, **skipping any the brief
already answers** (never ask what's already stated). Mode-aware:

- **idea:** (a) who is the actual target buyer? (b) what is your edge / what do you already have
  (distribution, assets)? (c) constraints & budget — how fast to first dollar?
- **technical:** (a) what does "good" look like / the goal? (b) hard constraints (stack, deadlines,
  RLS/perf budgets, team size)? (c) what alternatives have you already considered/rejected?

### 3. Assemble the brief

Compose a compact, structured **brief block** — the single source the whole council judges against:
the raw input + intake answers + detected mode. Every persona and the Judge receive this verbatim.

### 4. Fan-out — 5 persona sub-agents, ONE parallel batch

Dispatch **all five persona agents in a single message** (true parallelism, per
[[parallel-agent-dispatch]]) using the `Agent` tool (`general-purpose`, which has web + read
access). Each agent receives the brief + its persona rubric + the **required output schema** and
returns:

```
SCORE: <n>/10
TOP FINDINGS: <2-4 bullets>
THE ONE THING THAT MATTERS MOST: <one line>
VERDICT-LEAN: green | reshape | kill
```

**Roster (mode-aware):**

| Persona              | idea | technical | Job                                                                                                                                                |
| -------------------- | :--: | :-------: | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Contrarian**       |  ✓   |     ✓     | Find fatal flaws — only reasons it dies                                                                                                            |
| **Expansionist**     |  ✓   |     ✓     | Biggest upside / glass-half-full read                                                                                                              |
| **First-Principles** |  ✓   |     ✓     | Pure logic; **deliberately given no repo/market context** (avoids anchoring)                                                                       |
| **Deep Researcher**  |  ✓   |     ✓     | **Live web research** (WebSearch/WebFetch): idea → competitors/pricing/market; technical → prior art, library/approach comparisons, known pitfalls |
| **The Buyer**        |  ✓   |     —     | Role-plays the customer; would they actually pay? at what price?                                                                                   |
| **Maintainer**       |  —   |     ✓     | Long-term cost, complexity, operability, who-maintains-this                                                                                        |

So each run dispatches exactly **5 personas**: idea = Contrarian, Expansionist, First-Principles,
Deep Researcher, Buyer; technical = Contrarian, Expansionist, First-Principles, Deep Researcher,
Maintainer.

### 5. Judge — a separate 6th sub-agent

Dispatch **one** Judge agent that receives all five persona reports (scores + findings) + the brief
and returns the final verdict in the schema below. The Judge is a distinct agent from the personas
(separation of worker and judge). The orchestrator does **not** author the verdict itself — it
relays the Judge's output.

### 6. Render the verdict to chat

Print (chat only — nothing written to disk):

- **VERDICT: GREEN-LIGHT / RESHAPE / KILL** + **confidence** (low / med / high)
- **One-line call** — the crisp summary (e.g. "Kill it as described, but keep the engine and aim it
  at a narrow paying niche").
- **Why** — biggest risk + biggest upside.
- **Score table** — every persona's `/10`, as a real markdown table.
- **The cheapest test** — mode-aware: the single cheapest **48-hour test** (idea) / **validation
  spike** (technical) to run _before_ committing real work.

## Output schema (Judge → chat)

```
VERDICT: <GREEN-LIGHT | RESHAPE | KILL>   (confidence: <low|med|high>)

<one-line call>

WHY
- Biggest risk: <…>
- Biggest upside: <…>

SCORES
| Persona | Score |
| … | … |

CHEAPEST TEST (next 48h / spike)
<one concrete, cheap action to validate before building>
```

## Components & boundaries

- **The command file** (`.claude/commands/roast.md`) — orchestrator prose: mode detection → intake
  → brief assembly → parallel dispatch → judge → render. It owns no business logic beyond
  sequencing; all judgement lives in the dispatched agents.
- **Persona agents** — stateless, independent, judge only the brief, return the fixed schema. No
  shared state between them; this is what makes the parallel batch safe.
- **Deep Researcher agent** — the only persona that reaches the network; uses WebSearch/WebFetch.
- **Judge agent** — the only agent that sees all persona outputs; produces the verdict.

## Testing & verification

This is a prose orchestration command, not app code — there is no unit test to write, and the four
gates do not compile it. Verification scales to what is built (per AGENTS.md):

1. **Structural check** — the file parses as a valid command, registers as `/roast`, follows the
   repo header / numbered-step convention (compare against `whats-next.md`).
2. **Live dry-run #1 (idea mode)** — roast a sample business idea. Confirm: mode detected as
   `idea`; intake asks ≤3 buyer/edge/constraint questions; **5 persona agents dispatch in one
   parallel batch**; Deep Researcher makes real web calls; Judge renders verdict + score table +
   cheapest-48h-test.
3. **Live dry-run #2 (technical mode)** — roast a sample technical decision. Confirm: mode flips to
   `technical`; Buyer is swapped for Maintainer; intake questions change; verdict renders with a
   "cheapest validation spike".
4. **Gates still green** — run `pnpm typecheck && pnpm lint && pnpm test && pnpm build` to prove the
   addition broke nothing (they pass untouched; no source changed).

## Non-goals (YAGNI)

- No persistence — verdicts are chat-only; no saved report, no vault auto-log.
- No `--flags` — research is always live; mode is auto-detected (with prose override). No opt-in
  research flag.
- No scoring weights / aggregation math — the Judge reasons over the five reports holistically;
  the score table is informational, not a computed average gate.
- No model overrides — agents inherit the session model.
