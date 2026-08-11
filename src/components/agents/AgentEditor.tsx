"use client";

import { useState, useTransition } from "react";
import { ArrowLeft } from "lucide-react";
import { createAgent, deleteAgent, updateAgent } from "@/lib/agents/actions";
import {
  personalAgentSettingsSchema,
  type PersonalAgentSettings,
} from "@/lib/agents/agent-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  ModelPicker,
  providersWithoutModels,
  type ModelOption,
  type ModelValue,
} from "@/components/settings/ModelPicker";
import { cn } from "@/lib/utils";
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

const SELECT_CLASS =
  "border-input bg-transparent focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm transition-colors outline-none focus-visible:ring-3 disabled:opacity-50 dark:bg-input/30 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20";

type FieldErrors = Partial<
  Record<"name" | "instructions" | "runAtLocalHour" | "provider", string>
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
 */
export function AgentEditor({
  mode,
  agentId,
  initial,
  modelOptions,
  providers,
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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    setServerError(null);
    const candidate: PersonalAgentSettings = {
      name: name.trim(),
      templateId: initial.templateId,
      instructions: instructions.trim(),
      boardScope: initial.boardScope,
      cadence: initial.cadence,
      runAtLocalHour,
      enabled,
      // Both halves or neither — the schema refuses a half-pin, and null on
      // both is what "inherit the org default" means to the run endpoint.
      provider: model?.provider ?? null,
      modelId: model?.modelId ?? null,
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
      });
      return;
    }
    setFieldErrors({});

    startTransition(async () => {
      if (mode === "edit" && agentId) {
        const res = await updateAgent(agentId, parsed.data);
        if (!res.ok) {
          setServerError(res.error);
          return;
        }
        onSaved({ ...parsed.data, id: agentId });
        return;
      }

      const res = await createAgent(parsed.data);
      if (!res.ok) {
        setServerError(res.error);
        return;
      }
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
            onChange={(e) => {
              setName(e.target.value);
              setFieldErrors((f) => ({ ...f, name: undefined }));
            }}
          />
          {fieldErrors.name ? (
            <p className="text-destructive text-xs">{fieldErrors.name}</p>
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
            <p className="text-destructive text-xs">
              {fieldErrors.instructions}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="agent-hour">Runs daily at</Label>
            <select
              id="agent-hour"
              className={cn(SELECT_CLASS)}
              value={runAtLocalHour}
              disabled={pending}
              aria-invalid={Boolean(fieldErrors.runAtLocalHour)}
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
              <p className="text-destructive text-xs">
                {fieldErrors.runAtLocalHour}
              </p>
            ) : null}
          </div>

          <div className="flex-1 space-y-1.5">
            <Label htmlFor="agent-boards">Reads from</Label>
            <p
              id="agent-boards"
              className="text-muted-foreground flex h-8 items-center text-sm"
            >
              All boards you can see
            </p>
          </div>
        </div>

        {/* `role="group"` + `aria-labelledby`, not `htmlFor`: the picker's
            trigger is a combobox whose accessible name is its current VALUE,
            so a label pointing at it would replace the value a screen reader
            announces instead of naming the field. */}
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
          />
          <p className="text-muted-foreground text-xs">
            {model
              ? "This agent always runs on this model — the organization's default doesn't apply to it."
              : "This agent runs on the organization's default model. Pick one to keep it on a specific model instead."}
          </p>
          {fieldErrors.provider ? (
            <p className="text-destructive text-xs">{fieldErrors.provider}</p>
          ) : null}
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
          <Button type="button" onClick={save} disabled={pending} size="sm">
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
