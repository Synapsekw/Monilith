"use client";

import { useMemo, useState, useTransition } from "react";
import { ArrowLeft, FileText, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setAgentEnabled } from "@/lib/agents/actions";
import type { AgentTemplate } from "@/lib/agents/agent-config";
import { slugifyHandle } from "@/lib/agents/handle";
import type { AgentRunLike } from "@/lib/agents/run-status";
import { AgentRoster, type RosterAgent } from "@/components/agents/AgentRoster";
import { TemplateGallery } from "@/components/agents/TemplateGallery";
import {
  AgentEditor,
  type AgentRecord,
  type EditableAgent,
} from "@/components/agents/AgentEditor";
import { DocumentLibrary } from "@/components/agents/DocumentLibrary";
import type { ModelOption } from "@/components/settings/ModelPicker";
import type { AgentCapability } from "@/lib/agents/capabilities";
import type { AgentDocumentRow } from "@/lib/agents/documents-db";

type View = "roster" | "gallery" | "editor" | "library";

type EditorContext =
  | { mode: "create"; initial: EditableAgent }
  | {
      mode: "edit";
      agentId: string;
      initial: EditableAgent;
      initialDocumentIds: string[];
    };

/**
 * The one client boundary for this page: it owns which view is showing
 * (roster / template gallery / editor / reference-document library) as plain
 * React state. Switching views is an in-page toggle over data already loaded
 * by the server component — no `<Link>`, no `router.push`, zero new server
 * round-trips (working agreement #5 / gotcha-09: a router navigation here
 * would re-run every query on the page). Mutations
 * (`createAgent`/`updateAgent`/`setAgentEnabled`/`deleteAgent`) go through the
 * Server Actions in `src/lib/agents/actions.ts`; the library's own mutations
 * (`createDocument`/`updateDocument`/`deleteDocument`) live in
 * `src/lib/agents/document-actions.ts` and are called from `DocumentLibrary`
 * itself.
 */
export function AgentsSection({
  agents: initial,
  lastRuns = {},
  pendingProposals = {},
  maxAgents,
  modelOptions,
  providers,
  capabilityCeiling,
  documents,
  documentTotal,
  attachmentsByAgent,
  memoryTotals,
  orgDefaultContextLength,
}: {
  agents: AgentRecord[];
  /** Most recent run per agent id, read once by the server component. Absent
   *  keys mean "never ran", which is why this is a plain lookup and not part of
   *  `AgentRecord` — the editor's shape has no business carrying run data. */
  lastRuns?: Record<string, AgentRunLike>;
  /** Undecided proposals per agent id, from ONE tally the server component
   *  reads for the whole roster. Absent keys mean "nothing waiting", which is
   *  why this is a plain lookup rather than a field on `AgentRecord`. */
  pendingProposals?: Record<string, number>;
  /** `org_ai_settings.max_agents_per_user` — the cap the server ACTUALLY
   *  enforces in `assertCanCreateAgent`. Passed in rather than hardcoded: this
   *  label read "of 20" (the column's check-constraint ceiling) while the real
   *  default is 3, so the page promised 17 agents it would refuse to create. */
  maxAgents: number;
  /** Every selectable model, read once by the server component and threaded to
   *  the editor. Loaded on FIRST PAINT rather than when the editor opens:
   *  opening the editor is an in-page view switch and must cost no server round
   *  trip (working agreement #5). */
  modelOptions: ModelOption[];
  /** The enabled provider registry, so the picker can name the providers that
   *  have no models yet instead of hiding them. */
  providers: { id: string; label: string }[];
  /** `OrgAiSettings.agentCapabilityCeiling`, read once by the server page and
   *  threaded to the editor's capability toggles — same first-paint reasoning
   *  as `modelOptions` above. */
  capabilityCeiling: AgentCapability[];
  /** The owner's reference-document library, METADATA ONLY (no `body`) —
   *  read 6 on the page. Passed straight through to `DocumentLibrary`. */
  documents: AgentDocumentRow[];
  /** How many documents the owner ACTUALLY has, which is not `documents.length`
   *  once the library passes `LIBRARY_PAGE_SIZE`. Passed through so the list can
   *  say "showing 100 of 137" instead of silently capping at 100 forever. */
  documentTotal: number;
  /** Every user_agent's attached document ids, keyed by AGENT id — read 7 on
   *  the page (`listAttachmentsByAgent`). Inverted below into document id ->
   *  agent NAMES using the roster already in props, so the library's delete
   *  confirmation can name affected agents with no extra query. */
  attachmentsByAgent: Record<string, string[]>;
  /** Per-agent memory COUNT and TOKEN SUM — read 8 on the page
   *  (`listMemoryTotalsByAgent`), never the notes themselves. Keyed by agent
   *  id; an absent key means "remembers nothing", which is why this is a plain
   *  lookup rather than a field on `AgentRecord` (the editor's shape has no
   *  business carrying memory data, same reasoning as `lastRuns`). The
   *  selected agent's entry is threaded to `AgentEditor`, where it both sizes
   *  the document budget and fills the memory panel's collapsed counter with
   *  no fetch of its own. */
  memoryTotals: Record<string, { noteCount: number; tokenTotal: number }>;
  /** The org default model's `context_length`, resolved once by the server
   *  page from data it already reads for other reasons (`readOrgAiSettings` +
   *  `buildModelOptions`) — see the doc comment at its call site in
   *  `page.tsx`. Threaded to `AgentEditor` as the fallback the reference-
   *  document budget meter uses for an UNPINNED agent, so it budgets against
   *  the same model the run loop actually resolves to, not an optimistic
   *  guess. Null when the org has no resolvable default. */
  orgDefaultContextLength: number | null;
}) {
  const [agents, setAgents] = useState<AgentRecord[]>(initial);
  const [view, setView] = useState<View>("roster");

  // Document id -> the names of every agent that currently reads it.
  // Recomputed from the LIVE agents array (not the initial prop) so a rename
  // or a newly-created agent is reflected without a re-fetch.
  const attachedBy = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const agent of agents) {
      for (const docId of attachmentsByAgent[agent.id] ?? []) {
        (out[docId] ??= []).push(agent.name);
      }
    }
    return out;
  }, [agents, attachmentsByAgent]);
  const [editorContext, setEditorContext] = useState<EditorContext | null>(
    null,
  );
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // What the cap actually counts. `countAgentsForOwner` excludes
  // `kind = 'builtin'` — the seeded orchestrator is given, not chosen — so a
  // label that counted it would read "4 of 3" for someone the server would
  // happily let create a fourth. The LIST below is unfiltered: a built-in is
  // still an agent its owner edits, renames and switches off.
  const ownedCount = agents.filter((a) => a.kind !== "builtin").length;

  const rosterAgents: RosterAgent[] = agents.map((a) => ({
    id: a.id,
    name: a.name,
    handle: a.handle,
    templateId: a.templateId,
    // The cadence AND its day operand, so the row can say "Mondays at 07:00"
    // rather than the hardcoded "Daily at …" every row used to render.
    cadence: a.cadence,
    runAtLocalHour: a.runAtLocalHour,
    runOnWeekday: a.runOnWeekday,
    runOnDayOfMonth: a.runOnDayOfMonth,
    enabled: a.enabled,
    // Last-run status IS first paint — it's the signal that an agent is
    // failing, and hiding it behind an expand is what made every gotcha-70
    // failure mode silent. The full history behind it is what defers
    // (working agreement #5): `AgentRunHistory` fetches only on expand.
    lastRun: lastRuns[a.id] ?? null,
    pendingProposals: pendingProposals[a.id] ?? 0,
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

  function openLibrary() {
    setToggleError(null);
    setView("library");
  }

  function openEditorFromTemplate(template: AgentTemplate) {
    setEditorContext({
      mode: "create",
      initial: {
        name: template.name,
        // A template carries no handle of its own, and the schema requires one
        // — derive it from the display name, exactly as the migration's
        // backfill does. `slugifyHandle` is total, so this never seeds a
        // payload the schema would refuse.
        handle: slugifyHandle(template.name, template.id),
        // Only `seed_builtin_agent` writes `kind` — no client role holds a
        // grant on the column — so anything created here is user-made.
        kind: "user",
        templateId: template.id,
        instructions: template.instructions,
        boardScope: template.boardScope,
        cadence: template.cadence,
        runAtLocalHour: template.runAtLocalHour,
        enabled: true,
        // A template seeds no pin: a new agent inherits the org default until
        // its owner chooses otherwise.
        provider: null,
        modelId: null,
        // And no capabilities. A template is a starting point, never a grant —
        // every new agent begins read-only and is widened deliberately.
        capabilities: [],
        // Every template is daily, whose cadence shape is both day fields null.
        runOnWeekday: null,
        runOnDayOfMonth: null,
      },
    });
    setView("editor");
  }

  function openEditorFromAgent(id: string) {
    const agent = agents.find((a) => a.id === id);
    if (!agent) return;
    const { id: _id, ...settings } = agent;
    setEditorContext({
      mode: "edit",
      agentId: id,
      initial: settings,
      // From the same first-paint read the roster and the library came from
      // (`listAttachmentsByAgent`) — opening the editor is a view switch over
      // data already in hand, never a fetch (working agreement #5).
      initialDocumentIds: attachmentsByAgent[id] ?? [],
    });
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

  if (view === "library") {
    // `DocumentLibrary` itself has no "back" affordance — its view state is
    // scoped to list <-> add-document form, both still inside the library.
    // Leaving THIS section is the same view switch as leaving the gallery or
    // editor, so it belongs here, one level up, exactly like theirs.
    return (
      <div className="flex flex-col gap-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setView("roster")}
          className="w-fit"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Back
        </Button>
        <DocumentLibrary
          documents={documents}
          total={documentTotal}
          attachedBy={attachedBy}
        />
      </div>
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
        modelOptions={modelOptions}
        providers={providers}
        capabilityCeiling={capabilityCeiling}
        documents={documents}
        documentTotal={documentTotal}
        initialDocumentIds={
          editorContext.mode === "edit"
            ? editorContext.initialDocumentIds
            : undefined
        }
        // A create has no agent id yet, so it has no memory either — and the
        // fallback for an existing agent with no notes is the same empty
        // total. Both come from data already in hand; opening the editor stays
        // a view switch, never a fetch.
        memoryTotals={
          (editorContext.mode === "edit"
            ? memoryTotals[editorContext.agentId]
            : undefined) ?? { noteCount: 0, tokenTotal: 0 }
        }
        orgDefaultContextLength={orgDefaultContextLength}
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
          {ownedCount} of {maxAgents} {maxAgents === 1 ? "agent" : "agents"}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openLibrary}
          >
            <FileText aria-hidden className="size-4" />
            Reference documents
          </Button>
          <Button type="button" size="sm" onClick={openGallery}>
            <Plus aria-hidden className="size-4" />
            New agent
          </Button>
        </div>
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
