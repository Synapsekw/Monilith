import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { AskAiMark } from "@/components/brand/ask-ai-mark";
import { WindowFrame } from "../landing-mocks";
import {
  CmdStep,
  FlowConnector,
  FlowNode,
  Kpi,
  SoftBadge,
  SoftPill,
} from "./primitives";

/**
 * The framed product visuals for the landing feature sections. Split out of
 * `landing-sections.tsx` at the 800-line `max-lines` tripwire; the primitives
 * they compose live in `./primitives`.
 */

export function AutomationsVisual() {
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

export function AskPulseVisual() {
  return (
    <WindowFrame title="Ask AI" chip="⌘K">
      <div className="p-5">
        <div className="mb-4">
          <div className="text-kicker text-3xs mb-2 flex items-center gap-1.5 font-mono tracking-[0.1em] uppercase">
            You
          </div>
          <div className="bg-surface-muted border-border inline-block rounded-lg border px-3.5 py-3 text-sm">
            What&apos;s at risk in the Q3 launch and who&apos;s blocked?
          </div>
        </div>
        <div>
          <div className="text-kicker text-3xs mb-2 flex items-center gap-1.5 font-mono tracking-[0.1em] uppercase">
            <AskAiMark className="text-primary size-3" />
            AI
          </div>
          <div className="bg-primary/[0.06] border-primary/20 rounded-lg border px-4 py-3.5 text-sm leading-relaxed">
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

export function CommandVisual() {
  return (
    <WindowFrame title="Command · ⌘K" chip="AI">
      <div className="flex flex-col gap-3.5 p-5">
        <div className="bg-surface-muted border-border-hover flex items-center gap-3 rounded-lg border px-4 py-3.5">
          <Sparkles className="text-primary size-3.5 flex-none" />
          <span className="text-sm">
            Create a board to track Q4 hiring, with stages and owners
          </span>
          <span
            className="bg-primary ml-0.5 h-4 w-0.5 flex-none rounded-full"
            aria-hidden="true"
          />
        </div>
        <div className="text-kicker text-3xs font-mono tracking-[0.1em] uppercase">
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
          <span className="text-kicker text-3xs font-mono tracking-[0.08em]">
            ↵ to run · esc to edit
          </span>
          <span className="bg-primary text-primary-foreground shadow-glow-primary rounded-full px-4 py-2 text-xs font-bold">
            Confirm &amp; run
          </span>
        </div>
      </div>
    </WindowFrame>
  );
}

export function DashboardVisual() {
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
          <div className="text-kicker text-3xs mb-3.5 font-mono tracking-[0.1em] uppercase">
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
                <span className="text-kicker text-3xs absolute inset-x-0 -bottom-5 text-center font-mono">
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
