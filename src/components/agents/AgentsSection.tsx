"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setAgentEnabled } from "@/lib/agents/actions";
import type {
  AgentTemplate,
  PersonalAgentSettings,
} from "@/lib/agents/agent-config";
import type { AgentRunLike } from "@/lib/agents/run-status";
import { AgentRoster, type RosterAgent } from "@/components/agents/AgentRoster";
import { TemplateGallery } from "@/components/agents/TemplateGallery";
import { AgentEditor, type AgentRecord } from "@/components/agents/AgentEditor";

type View = "roster" | "gallery" | "editor";

type EditorContext =
  | { mode: "create"; initial: PersonalAgentSettings }
  | { mode: "edit"; agentId: string; initial: PersonalAgentSettings };

/**
 * The one client boundary for this page: it owns which view is showing
 * (roster / template gallery / editor) as plain React state. Switching views
 * is an in-page toggle over data already loaded by the server component — no
 * `<Link>`, no `router.push`, zero new server round-trips (working agreement
 * #5 / gotcha-09: a router navigation here would re-run every query on the
 * page). Mutations (`createAgent`/`updateAgent`/`setAgentEnabled`/
 * `deleteAgent`) go through the Server Actions in `src/lib/agents/actions.ts`.
 */
export function AgentsSection({
  agents: initial,
  lastRuns = {},
  maxAgents,
}: {
  agents: AgentRecord[];
  /** Most recent run per agent id, read once by the server component. Absent
   *  keys mean "never ran", which is why this is a plain lookup and not part of
   *  `AgentRecord` — the editor's shape has no business carrying run data. */
  lastRuns?: Record<string, AgentRunLike>;
  /** `org_ai_settings.max_agents_per_user` — the cap the server ACTUALLY
   *  enforces in `assertCanCreateAgent`. Passed in rather than hardcoded: this
   *  label read "of 20" (the column's check-constraint ceiling) while the real
   *  default is 3, so the page promised 17 agents it would refuse to create. */
  maxAgents: number;
}) {
  const [agents, setAgents] = useState<AgentRecord[]>(initial);
  const [view, setView] = useState<View>("roster");
  const [editorContext, setEditorContext] = useState<EditorContext | null>(
    null,
  );
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const rosterAgents: RosterAgent[] = agents.map((a) => ({
    id: a.id,
    name: a.name,
    templateId: a.templateId,
    cadence: a.cadence,
    runAtLocalHour: a.runAtLocalHour,
    enabled: a.enabled,
    // Last-run status IS first paint — it's the signal that an agent is
    // failing, and hiding it behind an expand is what made every gotcha-70
    // failure mode silent. The full history behind it is what defers
    // (working agreement #5): `AgentRunHistory` fetches only on expand.
    lastRun: lastRuns[a.id] ?? null,
  }));

  function handleToggle(id: string, enabled: boolean) {
    setToggleError(null);
    const previous = agents;
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, enabled } : a)));
    startTransition(async () => {
      const res = await setAgentEnabled(id, enabled);
      if (!res.ok) {
        setAgents(previous);
        setToggleError(res.error);
      }
    });
  }

  function openGallery() {
    setToggleError(null);
    setView("gallery");
  }

  function openEditorFromTemplate(template: AgentTemplate) {
    setEditorContext({
      mode: "create",
      initial: {
        name: template.name,
        templateId: template.id,
        instructions: template.instructions,
        boardScope: template.boardScope,
        cadence: template.cadence,
        runAtLocalHour: template.runAtLocalHour,
        enabled: true,
      },
    });
    setView("editor");
  }

  function openEditorFromAgent(id: string) {
    const agent = agents.find((a) => a.id === id);
    if (!agent) return;
    const { id: _id, ...settings } = agent;
    setEditorContext({ mode: "edit", agentId: id, initial: settings });
    setView("editor");
  }

  function handleSaved(record: AgentRecord) {
    setAgents((prev) => {
      const exists = prev.some((a) => a.id === record.id);
      return exists
        ? prev.map((a) => (a.id === record.id ? record : a))
        : [...prev, record];
    });
    setEditorContext(null);
    setView("roster");
  }

  function handleDeleted(id: string) {
    setAgents((prev) => prev.filter((a) => a.id !== id));
    setEditorContext(null);
    setView("roster");
  }

  function handleEditorCancel() {
    setEditorContext(null);
    setView("roster");
  }

  if (view === "gallery") {
    return (
      <TemplateGallery
        onSelect={openEditorFromTemplate}
        onBack={() => setView("roster")}
      />
    );
  }

  if (view === "editor" && editorContext) {
    return (
      <AgentEditor
        mode={editorContext.mode}
        agentId={
          editorContext.mode === "edit" ? editorContext.agentId : undefined
        }
        initial={editorContext.initial}
        onSaved={handleSaved}
        onCancel={handleEditorCancel}
        onDeleted={handleDeleted}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        {/* The count is INFORMATIONAL only — the button stays enabled at the
            cap on purpose. `caps.ts` is explicit that the cap is enforced
            server-side and "the UI shows the limit, it does not enforce it";
            disabling here would trade a readable message from
            `assertCanCreateAgent` for a dead control with no explanation. */}
        <p className="text-muted-foreground text-sm">
          {agents.length} of {maxAgents} {maxAgents === 1 ? "agent" : "agents"}
        </p>
        <Button type="button" size="sm" onClick={openGallery}>
          <Plus aria-hidden className="size-4" />
          New agent
        </Button>
      </div>
      {toggleError ? (
        <p role="alert" className="text-destructive text-sm">
          {toggleError}
        </p>
      ) : null}
      <AgentRoster
        agents={rosterAgents}
        onToggle={handleToggle}
        onEdit={openEditorFromAgent}
      />
      {agents.length === 0 ? (
        <TemplateGallery onSelect={openEditorFromTemplate} />
      ) : null}
    </div>
  );
}
