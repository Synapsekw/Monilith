"use client";

import { useState, useTransition } from "react";
import { ArrowLeft } from "lucide-react";
import { createAgent, deleteAgent, updateAgent } from "@/lib/agents/actions";
import {
  AGENT_CADENCES,
  personalAgentSettingsSchema,
  type AgentCadence,
  type PersonalAgentSettings,
} from "@/lib/agents/agent-config";
import type { AgentCapability } from "@/lib/agents/capabilities";
import { setAgentDocuments } from "@/lib/agents/document-actions";
import type { AgentDocumentRow } from "@/lib/agents/documents-db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { FieldStatus, useFieldStatus } from "@/components/ui/field-status";
import {
  ModelPicker,
  providersWithoutModels,
  type ModelOption,
  type ModelValue,
} from "@/components/settings/ModelPicker";
import { CapabilityToggles } from "@/components/agents/CapabilityToggles";
import { DocumentPicker } from "@/components/agents/DocumentPicker";
import { MemoryPanel } from "@/components/agents/MemoryPanel";
import { useRestoreFocusAfterPending } from "@/lib/hooks/use-restore-focus-after-pending";
import { cn } from "@/lib/utils";

const NAME_ERROR_ID = "agent-name-error";
const INSTRUCTIONS_ERROR_ID = "agent-instructions-error";
const CADENCE_ERROR_ID = "agent-cadence-error";
const HOUR_ERROR_ID = "agent-hour-error";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type AgentRecord = PersonalAgentSettings & { id: string };

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** 0-6, Sunday-first — matches the `runOnWeekday` column (Postgres
 *  `extract(dow …)`), so the option VALUE needs no translation on save. */
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** 1-28 — the day-of-month ceiling `agent-config.ts` documents: the largest
 *  day present in every month, so no agent silently skips February. */
const DAYS_OF_MONTH = Array.from({ length: 28 }, (_, i) => i + 1);

const CADENCE_LABELS: Record<AgentCadence, string> = {
  daily: "Every day",
  weekdays: "Weekdays",
  weekly: "Weekly",
  monthly: "Monthly",
  // Spec 3: never swept, only summoned — by `@handle` or by another agent
  // delegating to it. The select is driven by this map, so a cadence missing
  // from it renders as an empty option.
  manual: "Only when I ask",
};

const SELECT_CLASS =
  "border-input bg-transparent focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm transition-colors outline-none focus-visible:ring-3 disabled:opacity-50 dark:bg-input/30 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20";

type FieldErrors = Partial<
  Record<
    "name" | "instructions" | "runAtLocalHour" | "provider" | "cadence",
    string
  >
>;

/**
 * Create/edit form for a single agent. Validates locally against
 * `personalAgentSettingsSchema` before calling the Server Action — client-side
 * validation gives instant field feedback, the schema re-validates server-side
 * (never trust the client). Server-side `fail()` messages are rendered inline,
 * never swallowed. Board scope is read-only in this phase (every template
 * ships `{ mode: "all" }`, i.e. everything the owner's RLS already lets them
 * see) — a per-board picker needs its own bounded board-list query and is out
 * of scope for the settings editor.
 *
 * The model pin is the same `ModelPicker` the org default uses, fed the same
 * flat option list. It is CLIENT STATE over a list the page already loaded:
 * opening it, searching it, and switching provider inside it are zero server
 * round-trips (working agreement #5). The only server call this form makes is
 * the save itself.
 *
 * Authorization is the owner's, not an admin's: an agent belongs to one person,
 * `updateAgent` filters `owner_id`, and RLS is the real boundary — so unlike
 * the org default (which `requireOrgAdmin`s), pinning a model here needs no
 * extra role. The pin cannot widen what the agent can reach: it selects a
 * model, and the key that pays for it is still resolved per run from the org's
 * mode and the owner's own credentials.
 *
 * Capabilities are the write side of that same ladder: `CapabilityToggles`
 * renders the agent's own grant set against `capabilityCeiling` (the org
 * admin's clamp, `OrgAiSettings.agentCapabilityCeiling`) and disables anything
 * outside it. The intersection happens again at RUN time regardless of what
 * gets saved here — disabling is only so the owner never sets a grant that
 * would be silently dropped at 07:00.
 */
export function AgentEditor({
  mode,
  agentId,
  initial,
  modelOptions,
  providers,
  capabilityCeiling,
  documents,
  documentTotal = documents.length,
  initialDocumentIds = [],
  memoryTotals = { noteCount: 0, tokenTotal: 0 },
  orgDefaultContextLength,
  onSaved,
  onCancel,
  onDeleted,
}: {
  mode: "create" | "edit";
  agentId?: string;
  initial: PersonalAgentSettings;
  /** Every selectable model, built server-side by the page (buildModelOptions). */
  modelOptions: ModelOption[];
  /** The enabled provider registry, for the "no models yet" groups. */
  providers: { id: string; label: string }[];
  /** `OrgAiSettings.agentCapabilityCeiling`, read once by the server page. */
  capabilityCeiling: AgentCapability[];
  /** The owner's reference-document library, METADATA ONLY (no `body`) — read
   *  once by the server page and threaded straight to `DocumentPicker`. */
  documents: AgentDocumentRow[];
  /** How many documents the owner ACTUALLY has — same value threaded to
   *  `DocumentLibrary`'s `total` prop, from the same `listDocumentsForOwner`
   *  read. `documents` is capped at `LIBRARY_PAGE_SIZE`, so once a library
   *  outgrows a page this diverges from `documents.length`; forwarded to
   *  `DocumentPicker` so it can say so instead of silently hiding anything
   *  past the cap. Defaults to `documents.length` (no cap in effect) so
   *  callers with nothing to report don't have to invent a number. */
  documentTotal?: number;
  /** This agent's currently-attached document ids, in saved order. Empty for
   *  a brand-new agent (`mode: "create"` never has anything attached yet). */
  initialDocumentIds?: string[];
  /** This agent's memory COUNT and TOKEN SUM, from the page's first-paint
   *  aggregate (`listMemoryTotalsByAgent`) — never the notes themselves. The
   *  token sum is what the document budget must subtract (the run loop draws
   *  both from ONE knowledge envelope, so a meter that ignored memory would
   *  promise room the run has already spent); the count is what the panel's
   *  `N of 50` renders without a fetch. Defaults to an empty memory, which is
   *  the true value for a `mode: "create"` agent and lets callers with nothing
   *  to report — tests, mainly — skip it, exactly like `documentTotal`. */
  memoryTotals?: { noteCount: number; tokenTotal: number };
  /** The org default model's `context_length`, resolved once by the server
   *  page (`page.tsx`) from data it already reads. The budget meter falls
   *  back to this whenever the pin can't name a usable model directly — see
   *  the doc comment beside its use below. */
  orgDefaultContextLength: number | null;
  onSaved: (record: AgentRecord) => void;
  onCancel: () => void;
  onDeleted?: (id: string) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [instructions, setInstructions] = useState(initial.instructions);
  const [runAtLocalHour, setRunAtLocalHour] = useState(initial.runAtLocalHour);
  const [enabled, setEnabled] = useState(initial.enabled);
  // Null means "inherit". The two halves are stored as one value because they
  // are only meaningful together — a model id names nothing without a provider.
  const [model, setModel] = useState<ModelValue | null>(
    initial.provider && initial.modelId
      ? { provider: initial.provider, modelId: initial.modelId }
      : null,
  );
  const [cadence, setCadence] = useState<AgentCadence>(initial.cadence);
  const [runOnWeekday, setRunOnWeekday] = useState(initial.runOnWeekday);
  const [runOnDayOfMonth, setRunOnDayOfMonth] = useState(
    initial.runOnDayOfMonth,
  );
  const [capabilities, setCapabilities] = useState<AgentCapability[]>(
    initial.capabilities,
  );
  // Client state over the library already loaded by the server page — every
  // toggle in `DocumentPicker` is 0 new server round-trips (working agreement
  // #5). Persisted only on save, via `saveDocuments` below, exactly like
  // every other field in this form.
  const [selectedDocumentIds, setSelectedDocumentIds] =
    useState<string[]>(initialDocumentIds);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  // Save disables itself the instant `pending` flips true, synchronously in
  // its own click handler — the click that gave it focus. A browser has
  // nowhere else to send focus when the active element is disabled out from
  // under it, so it drops to `<body>` and a keyboard or screen-reader user
  // loses their place on the page. This reclaims it once the save settles,
  // without stealing focus the user moved on purpose.
  const saveRef = useRestoreFocusAfterPending<HTMLButtonElement>(pending);

  // The catalog entry behind the current pin, if any — the source of truth
  // for whether this agent's run can use tools at all. `undefined` when the
  // pin names a model that has been retired out from under the owner (see
  // the "shows an existing pin" doc above the picker): there is no evidence
  // either way then, so the warning stays silent rather than guessing.
  const selectedModelOption = model
    ? modelOptions.find(
        (o) => o.provider === model.provider && o.modelId === model.modelId,
      )
    : undefined;

  // The model field's own error. Unlike the hand-wired ids above it, the
  // control is a combobox inside `ModelPicker`, which already describes itself
  // with the current selection — so the message goes in through the picker's
  // `describedBy`, which MERGES ids rather than replacing them. Only the
  // description half of `controlProps` is used: `aria-invalid` would restyle
  // the trigger (`<Button>` variants paint a destructive border and ring for
  // it), and this is an announcement fix, not a visual one.
  const providerStatus = useFieldStatus(fieldErrors.provider);

  function cadenceChanged(next: AgentCadence) {
    setCadence(next);
    // Each cadence has exactly one day operand (`cadenceFieldsMatch`) — reset
    // both, then set only the one the new cadence needs. `?? 1` on entry
    // (Sunday isn't a sensible silent default here) keeps a value the owner
    // picked before if they switch back and forth.
    setRunOnWeekday(next === "weekly" ? (runOnWeekday ?? 1) : null);
    setRunOnDayOfMonth(next === "monthly" ? (runOnDayOfMonth ?? 1) : null);
    setFieldErrors((f) => ({ ...f, cadence: undefined }));
  }

  function save() {
    setServerError(null);
    const candidate: PersonalAgentSettings = {
      name: name.trim(),
      // Straight through, unedited: this editor has no handle FIELD yet, and a
      // save that dropped the handle would fail validation on a value the form
      // never showed. Re-sending what was loaded keeps a rename of the display
      // name from silently re-addressing the agent.
      handle: initial.handle,
      templateId: initial.templateId,
      instructions: instructions.trim(),
      boardScope: initial.boardScope,
      cadence,
      runAtLocalHour,
      enabled,
      // Both halves or neither — the schema refuses a half-pin, and null on
      // both is what "inherit the org default" means to the run endpoint.
      provider: model?.provider ?? null,
      modelId: model?.modelId ?? null,
      capabilities,
      runOnWeekday,
      runOnDayOfMonth,
    };

    const parsed = personalAgentSettingsSchema.safeParse(candidate);
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setFieldErrors({
        name: flat.name?.[0],
        instructions: flat.instructions?.[0],
        runAtLocalHour: flat.runAtLocalHour?.[0],
        // Unreachable through the picker (it only ever yields a complete pair
        // or null) — surfaced anyway, because a validation error the form
        // cannot render is a save button that silently does nothing.
        provider: flat.provider?.[0],
        // Unreachable through `cadenceChanged` (it always sets the matching
        // day operand) — surfaced for the same reason as `provider` above.
        cadence: flat.cadence?.[0],
      });
      return;
    }
    setFieldErrors({});

    // The attachment set only changed if it differs from what was loaded —
    // order matters (it becomes `position`, which is what keeps the prompt
    // byte-stable across runs), so this is a straight array comparison, not a
    // set comparison. A create is always empty on entry, so any pick at all
    // counts as changed. Skipping the call when nothing changed keeps the
    // common "no attachments touched" save at its usual single round trip.
    const documentIdsChanged =
      JSON.stringify(selectedDocumentIds) !==
      JSON.stringify(initialDocumentIds);

    // Runs after the agent itself is created/updated, since `setAgentDocuments`
    // needs a real `user_agent_id` — a brand-new agent doesn't have one until
    // `createAgent` returns it. Returns false (and leaves `serverError` set,
    // the form still open) on failure, so a save that renamed the agent but
    // failed to attach a document is never reported to the owner as a clean
    // success — `DocumentPicker` itself never talks to the server; this is
    // the one call site that does, exactly once, on save.
    async function saveDocuments(id: string): Promise<boolean> {
      if (!documentIdsChanged) return true;
      const res = await setAgentDocuments({
        userAgentId: id,
        documentIds: selectedDocumentIds,
      });
      if (!res.ok) {
        setServerError(res.error);
        return false;
      }
      return true;
    }

    startTransition(async () => {
      if (mode === "edit" && agentId) {
        const res = await updateAgent(agentId, parsed.data);
        if (!res.ok) {
          setServerError(res.error);
          return;
        }
        if (!(await saveDocuments(agentId))) return;
        onSaved({ ...parsed.data, id: agentId });
        return;
      }

      const res = await createAgent(parsed.data);
      if (!res.ok) {
        setServerError(res.error);
        return;
      }
      if (!(await saveDocuments(res.data.id))) return;
      onSaved({ ...parsed.data, id: res.data.id });
    });
  }

  function confirmDeleteAgent() {
    if (!agentId) return;
    startTransition(async () => {
      const res = await deleteAgent(agentId);
      if (!res.ok) {
        setServerError(res.error);
        setConfirmDelete(false);
        return;
      }
      setConfirmDelete(false);
      onDeleted?.(agentId);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onCancel}
        disabled={pending}
        className="w-fit"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Back
      </Button>

      <div className="flex flex-col gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="agent-name">Name</Label>
          <Input
            id="agent-name"
            value={name}
            disabled={pending}
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? NAME_ERROR_ID : undefined}
            onChange={(e) => {
              setName(e.target.value);
              setFieldErrors((f) => ({ ...f, name: undefined }));
            }}
          />
          {fieldErrors.name ? (
            <p
              id={NAME_ERROR_ID}
              role="alert"
              className="text-destructive text-xs"
            >
              {fieldErrors.name}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="agent-instructions">Instructions</Label>
          <Textarea
            id="agent-instructions"
            rows={5}
            value={instructions}
            disabled={pending}
            aria-invalid={Boolean(fieldErrors.instructions)}
            aria-describedby={
              fieldErrors.instructions ? INSTRUCTIONS_ERROR_ID : undefined
            }
            onChange={(e) => {
              setInstructions(e.target.value);
              setFieldErrors((f) => ({ ...f, instructions: undefined }));
            }}
          />
          <p className="text-muted-foreground text-xs">
            What the daily email should focus on. Plain language — this is sent
            straight to the model.
          </p>
          {fieldErrors.instructions ? (
            <p
              id={INSTRUCTIONS_ERROR_ID}
              role="alert"
              className="text-destructive text-xs"
            >
              {fieldErrors.instructions}
            </p>
          ) : null}
        </div>

        <div
          className="space-y-1.5"
          role="group"
          aria-labelledby="agent-documents-label"
        >
          <Label id="agent-documents-label">Reference documents</Label>
          {/* `contextLength` comes from the PIN's own catalog row when one
              resolves to a live model. `selectedModelOption` is `undefined`
              in BOTH cases where it doesn't: no pin at all, and a pin naming
              a model the catalog no longer carries (retired since it was
              set). Those are not two different situations to the RUN
              LOOP — `pickModel` (resolve.ts) sends a missing pin through the
              exact same org-default fallback as no pin at all — so the meter
              must not treat them differently either. `orgDefaultContextLength`
              is that same fallback, resolved once by the server page from
              catalog data it already has; it stays `null` only when the org
              has no resolvable default, which is the one case nobody here
              can predict — the meter then honestly discloses the assumed
              context instead of guessing a window nothing confirmed. */}
          <DocumentPicker
            documents={documents}
            total={documentTotal}
            selectedIds={selectedDocumentIds}
            onChange={setSelectedDocumentIds}
            contextLength={
              selectedModelOption?.contextLength ?? orgDefaultContextLength
            }
            instructions={instructions}
            // Documents and memory share ONE knowledge envelope in the run
            // loop. Passing this is what keeps the meter honest about what is
            // actually left for documents.
            memoryTokens={memoryTotals.tokenTotal}
          />
        </div>

        <div
          className="space-y-1.5"
          role="group"
          aria-labelledby="agent-memory-label"
        >
          <Label id="agent-memory-label">Memory</Label>
          {/* Directly below the documents it shares a budget with. `agentId`
              is undefined until a create is saved — the panel renders its own
              "save this agent first" state for that, since a note needs a real
              `user_agent_id` to hang off. */}
          <MemoryPanel agentId={agentId ?? null} totals={memoryTotals} />
        </div>

        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="agent-cadence">Runs</Label>
            <select
              id="agent-cadence"
              className={cn(SELECT_CLASS)}
              value={cadence}
              disabled={pending}
              aria-invalid={Boolean(fieldErrors.cadence)}
              aria-describedby={
                fieldErrors.cadence ? CADENCE_ERROR_ID : undefined
              }
              onChange={(e) => cadenceChanged(e.target.value as AgentCadence)}
            >
              {AGENT_CADENCES.map((c) => (
                <option key={c} value={c}>
                  {CADENCE_LABELS[c]}
                </option>
              ))}
            </select>
            {fieldErrors.cadence ? (
              <p
                id={CADENCE_ERROR_ID}
                role="alert"
                className="text-destructive text-xs"
              >
                {fieldErrors.cadence}
              </p>
            ) : null}
          </div>

          <div className="flex-1 space-y-1.5">
            <Label htmlFor="agent-hour">At</Label>
            <select
              id="agent-hour"
              className={cn(SELECT_CLASS)}
              value={runAtLocalHour}
              disabled={pending}
              aria-invalid={Boolean(fieldErrors.runAtLocalHour)}
              aria-describedby={
                fieldErrors.runAtLocalHour ? HOUR_ERROR_ID : undefined
              }
              onChange={(e) => {
                setRunAtLocalHour(Number(e.target.value));
                setFieldErrors((f) => ({ ...f, runAtLocalHour: undefined }));
              }}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
            {fieldErrors.runAtLocalHour ? (
              <p
                id={HOUR_ERROR_ID}
                role="alert"
                className="text-destructive text-xs"
              >
                {fieldErrors.runAtLocalHour}
              </p>
            ) : null}
          </div>
        </div>

        {/* Only ever one of these two — mirrors `cadenceFieldsMatch`: weekly
            needs a weekday and no day-of-month, monthly the reverse, and
            daily/weekdays need neither. */}
        {cadence === "weekly" ? (
          <div className="space-y-1.5">
            <Label htmlFor="agent-weekday">Weekday</Label>
            <select
              id="agent-weekday"
              className={cn(SELECT_CLASS)}
              value={runOnWeekday ?? 1}
              disabled={pending}
              onChange={(e) => setRunOnWeekday(Number(e.target.value))}
            >
              {WEEKDAYS.map((label, day) => (
                <option key={day} value={day}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {cadence === "monthly" ? (
          <div className="space-y-1.5">
            <Label htmlFor="agent-day-of-month">Day of month</Label>
            <select
              id="agent-day-of-month"
              className={cn(SELECT_CLASS)}
              value={runOnDayOfMonth ?? 1}
              disabled={pending}
              onChange={(e) => setRunOnDayOfMonth(Number(e.target.value))}
            >
              {DAYS_OF_MONTH.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <p className="text-muted-foreground text-xs">
              Capped at 28 so this agent never silently skips February.
            </p>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="agent-boards">Reads from</Label>
          <p
            id="agent-boards"
            className="text-muted-foreground flex h-8 items-center text-sm"
          >
            All boards you can see
          </p>
        </div>

        {/* `role="group"` + `aria-labelledby` complements — not substitutes
            for — the picker's own accessible name: `ModelPicker` takes a
            static `label` prop below (its name no longer comes from the live
            value, which is instead its accessible DESCRIPTION), so a screen
            reader landing directly on the combobox via Tab also hears
            "Model", not just navigators that go through this group. */}
        <div
          className="space-y-1.5"
          role="group"
          aria-labelledby="agent-model-label"
        >
          <Label id="agent-model-label">Model</Label>
          <ModelPicker
            options={modelOptions}
            emptyProviders={providersWithoutModels(providers, modelOptions)}
            value={model}
            onChange={(next) => {
              setModel(next);
              setFieldErrors((f) => ({ ...f, provider: undefined }));
            }}
            disabled={pending}
            allowInherit
            inheritLabel="Use the organization's default"
            // Three of the seeded providers have no verified models until
            // someone saves a key for them, so the empty list is a
            // configuration state with a next step — never "no models
            // available", which reads as a broken feature.
            emptyHint="Add an API key in Settings → AI to see models."
            label="Model"
            describedBy={providerStatus.controlProps["aria-describedby"]}
          />
          <p className="text-muted-foreground text-xs">
            {model
              ? "This agent always runs on this model — the organization's default doesn't apply to it."
              : "This agent runs on the organization's default model. Pick one to keep it on a specific model instead."}
          </p>
          {/* The run loop is provider-agnostic (Task 7) — what actually limits
              an agent is the selected model's OWN `supportsTools` flag, not
              its provider. A tool-incapable model still runs; it just cannot
              call `get_my_work` or anything else, so the loop degrades to a
              plain summary instead of skipping. Silent about a retired pin
              (`selectedModelOption` undefined) — no evidence either way. */}
          {model &&
          selectedModelOption &&
          !selectedModelOption.supportsTools ? (
            <p role="status" className="text-destructive text-xs">
              This model can&apos;t use tools, so this agent can only write a
              summary. Pick a tool-capable model to let it act.
            </p>
          ) : null}
          <FieldStatus field={providerStatus} />
        </div>

        <div
          className="space-y-1.5"
          role="group"
          aria-labelledby="agent-capabilities-label"
        >
          <Label id="agent-capabilities-label">What this agent can do</Label>
          <CapabilityToggles
            value={capabilities}
            ceiling={capabilityCeiling}
            onChange={setCapabilities}
            disabled={pending}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <Label htmlFor="agent-enabled">Enabled</Label>
            <p className="text-muted-foreground text-xs">
              Turn off to pause the daily email without deleting the agent.
            </p>
          </div>
          <Switch
            id="agent-enabled"
            checked={enabled}
            disabled={pending}
            aria-label="Enabled"
            onCheckedChange={setEnabled}
          />
        </div>
      </div>

      {serverError ? (
        <p role="alert" className="text-destructive text-sm">
          {serverError}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            ref={saveRef}
            type="button"
            onClick={save}
            disabled={pending}
            size="sm"
          >
            {pending
              ? "Saving…"
              : mode === "edit"
                ? "Save changes"
                : "Create agent"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </Button>
        </div>

        {mode === "edit" && agentId ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() => setConfirmDelete(true)}
          >
            Delete
          </Button>
        ) : null}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this agent?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{name}&quot; will stop running and its history is removed.
              This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDeleteAgent();
              }}
              disabled={pending}
            >
              {pending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
