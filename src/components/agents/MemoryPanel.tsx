"use client";

import { useState } from "react";
import { ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/ui/status-pill";
import { FieldStatus, useFieldStatus } from "@/components/ui/field-status";
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
import {
  listAgentMemory,
  saveOwnerNote,
  deleteMemoryNote,
} from "@/lib/agents/memory-actions";
import type { AgentMemoryNote } from "@/lib/agents/memory-db";
import {
  MEMORY_MAX_KEY_CHARS,
  MEMORY_MAX_NOTES,
  MEMORY_MAX_VALUE_CHARS,
} from "@/lib/agents/document-budget";
import {
  memoryKeySchema,
  memoryValueSchema,
} from "@/lib/validations/agent-memory";
import { timeAgo } from "@/lib/boards/automation-runs";

/**
 * What one agent remembers: the count, the notes behind it, and the owner's
 * own writes into the same store. Every decision here, and why:
 *
 * COLLAPSED, AND COUNTING FROM PROPS. The header renders `{noteCount} of 50`
 * and the token total straight from `totals`, which the settings page already
 * read on first paint (`listMemoryTotalsByAgent` — count and token sum, never
 * `value`). So mounting this panel costs ZERO server round-trips, which is
 * what lets the editor open as a pure client-state view switch (working
 * agreement #5 / gotcha-09).
 *
 * THE NOTE LIST LOADS ON ONE EXPLICIT CLICK, ONCE. Expanding calls
 * `listAgentMemory(agentId)` and caches the result in component state;
 * collapsing and reopening re-renders that cache rather than re-reading. This
 * is exactly the posture `AgentRunHistory` already ships for run history ("an
 * explicit disclosure of ONE agent's data on an explicit click, not a view
 * toggle") — a memory set is at most 50 x 500 chars, small on one click and
 * indefensible x20 on every paint. It holds the cache in `useState` rather
 * than TanStack Query only because it has exactly one query with no shared
 * consumers; the caching RULE is the same one.
 *
 * PROVENANCE IS RENDERED, NOT INFERRED. Each note shows its key, its value, an
 * origin badge ("Written by this agent" / "Written by you") and when it last
 * changed. A memory nobody can audit is a memory nobody can falsify — and
 * these notes are injected into a prompt above the owner's own instructions
 * every single run.
 *
 * THE VALUE FIELD IS A SINGLE-LINE `<Input>`, NEVER A `<Textarea>`. The column
 * itself refuses newlines (`agent_memory.value`'s check constraint, mirrored
 * by `memoryValueSchema`): one line is structural containment, because a value
 * that cannot contain a newline cannot open a block or forge a heading in the
 * prompt. A `<Textarea>` would advertise a shape the store will not accept.
 * Pressing Enter in that field therefore does not submit and does not insert —
 * a single-line input would silently swallow the break, and silently dropping
 * what the owner typed is the failure `memoryValueSchema` refuses to commit
 * (it REJECTS newlines rather than stripping them). Instead the panel records
 * that the note being written wanted a line break and refuses to save until
 * the field is cleared and rewritten as one line.
 *
 * VALIDATION IS THE SERVER'S OWN SCHEMA, IMPORTED. `memoryKeySchema` /
 * `memoryValueSchema` are the same objects `saveOwnerNote` validates with, so
 * the client cannot drift from the server's wording or its rules — no message
 * is retyped here. The server re-validates regardless; this is feedback, not
 * enforcement. Messages are wired to their control through `useFieldStatus` /
 * `<FieldStatus>` (`aria-describedby` + `aria-invalid`), matching every field
 * in `AgentEditor`.
 *
 * DELETE GOES THROUGH `<AlertDialog>` NAMING THE KEY, exactly as
 * `DocumentLibrary`'s delete confirmation names the document. A note is
 * context the agent has been acting on; removing it silently is how an owner
 * discovers the change at 07:00 instead of now.
 *
 * EVERY MUTATION IS A SERVER ACTION AND NOTHING NAVIGATES. No `<Link>`, no
 * `router.push` — a navigation here would re-run every query on the settings
 * page to show data this component is already holding (gotcha-09).
 *
 * AN UNSAVED AGENT GETS A SENTENCE, NOT A FORM. `saveOwnerNote` needs a real
 * `user_agent_id`, and unlike `DocumentPicker` (whose selection is form state
 * the editor persists on save) there is nothing sensible to hold pending — so
 * `agentId === null` says so and offers nothing.
 */

/**
 * The newline rule IN THE SCHEMA'S OWN WORDS, derived by asking the schema
 * about a two-line value rather than retyping its message. A copied string
 * here would drift from `memoryValueSchema` the first time the wording
 * changed, and nothing would catch it. The fallback is unreachable (the schema
 * rejects that input by construction) and exists only to keep the constant a
 * `string`.
 */
const SINGLE_LINE_MESSAGE =
  memoryValueSchema.safeParse("one\ntwo").error?.issues[0]?.message ??
  "A note must be a single line.";

const KEY_HINT_ID = "agent-memory-key-hint";

type Draft = { key: string; value: string; editing: boolean };

export function MemoryPanel({
  agentId,
  totals,
}: {
  /** Null for an agent that has not been created yet — there is no row for a
   *  note to hang off, so the panel offers nothing. */
  agentId: string | null;
  /** This agent's entry from the page's first-paint aggregate. The collapsed
   *  panel renders entirely from this: no fetch on mount, ever. */
  totals: { noteCount: number; tokenTotal: number };
}) {
  const [open, setOpen] = useState(false);
  /** Null = not loaded yet. An empty array is a loaded, empty memory — the two
   *  must not be conflated, or reopening would refetch forever. */
  const [notes, setNotes] = useState<AgentMemoryNote[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [draft, setDraft] = useState<Draft | null>(null);
  /** The owner pressed Enter in the single-line note field. Cleared when the
   *  field is emptied (nothing left to preserve) or the form closes — not on
   *  the next keystroke, because the break is still in the note they mean to
   *  write and the field cannot show it. */
  const [lineBreakDropped, setLineBreakDropped] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [valueError, setValueError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<AgentMemoryNote | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const keyStatus = useFieldStatus(keyError, "error", KEY_HINT_ID);
  const valueStatus = useFieldStatus(valueError);

  // Once the list is loaded it is the better count — a save or a delete moves
  // it immediately, while `totals` only catches up when the server page
  // revalidates. Before that, the aggregate is all there is, and it is enough.
  const noteCount = notes?.length ?? totals.noteCount;
  const tokenTotal = notes
    ? notes.reduce((sum, n) => sum + n.tokenEstimate, 0)
    : totals.tokenTotal;
  const atCap = noteCount >= MEMORY_MAX_NOTES;

  async function load(id: string) {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await listAgentMemory(id);
      if (!res.ok) {
        setLoadError(res.error);
        return;
      }
      setNotes(res.data.notes);
    } catch {
      setLoadError("Couldn't load this agent's memory.");
    } finally {
      setLoading(false);
    }
  }

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    // Only the FIRST expand reads. A failed read leaves `notes` null, so
    // reopening retries — which is the one case where a second call is the
    // point rather than a regression.
    if (next && agentId && notes === null && !loading) void load(agentId);
  }

  function openCreate() {
    setDraft({ key: "", value: "", editing: false });
    setLineBreakDropped(false);
    setKeyError(null);
    setValueError(null);
    setSaveError(null);
  }

  /** Editing keeps the key FIXED: the key is the note's identity (the store is
   *  keyed on `(user_agent_id, key)`), so an editable one would quietly create
   *  a second note instead of renaming this one. */
  function openEdit(note: AgentMemoryNote) {
    setDraft({ key: note.key, value: note.value, editing: true });
    setLineBreakDropped(false);
    setKeyError(null);
    setValueError(null);
    setSaveError(null);
  }

  function closeForm() {
    setDraft(null);
    setLineBreakDropped(false);
    setKeyError(null);
    setValueError(null);
    setSaveError(null);
  }

  async function save() {
    if (!draft || !agentId) return;
    setSaveError(null);

    const parsedKey = memoryKeySchema.safeParse(draft.key);
    if (!parsedKey.success) {
      setKeyError(parsedKey.error.issues[0]?.message ?? "Invalid key.");
      return;
    }
    setKeyError(null);

    // The dropped line break outranks the field's current contents: what the
    // owner is writing has two lines in it, whatever the input can display.
    if (lineBreakDropped) {
      setValueError(SINGLE_LINE_MESSAGE);
      return;
    }
    const parsedValue = memoryValueSchema.safeParse(draft.value);
    if (!parsedValue.success) {
      setValueError(parsedValue.error.issues[0]?.message ?? "Invalid note.");
      return;
    }
    setValueError(null);

    setSaving(true);
    try {
      const res = await saveOwnerNote({
        userAgentId: agentId,
        key: parsedKey.data,
        value: parsedValue.data,
      });
      if (!res.ok) {
        // The server's own message, never a restatement of it: it distinguishes
        // the cap from a failed write, and only it knows which happened.
        setSaveError(res.error);
        return;
      }
      closeForm();
      // The note just written is the thing the owner wants to see, so the list
      // opens and re-reads. This is a MUTATION's round trip, not an expand's —
      // the 0-round-trip budget is about in-page toggles.
      setOpen(true);
      await load(agentId);
    } catch {
      setSaveError("Couldn't save that note.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteNote() {
    if (!confirmDelete || !agentId) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await deleteMemoryNote(confirmDelete.id);
      if (!res.ok) {
        setDeleteError(res.error);
        return;
      }
      setConfirmDelete(null);
      await load(agentId);
    } catch {
      setDeleteError("Couldn't delete that note.");
    } finally {
      setDeleting(false);
    }
  }

  if (!agentId) {
    return (
      <p className="text-muted-foreground text-xs">
        Save this agent first, then you can add notes. Anything it learns on a
        run shows up here too.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="bg-surface-muted flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={toggleOpen}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring ease-keystone flex items-center gap-1 rounded-md text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "ease-keystone size-3 transition-transform",
              open && "rotate-90",
            )}
          />
          What this agent remembers
        </button>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground font-mono text-xs">
            {noteCount} of {MEMORY_MAX_NOTES} notes ·{" "}
            {tokenTotal.toLocaleString()} tokens
          </span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={openCreate}
            // At the cap the control is disabled AND the reason is on screen
            // below — `caps.ts`'s objection to a dead control is about controls
            // that disable with no explanation, which this one is not. Editing
            // an existing note stays available at 50/50 (the row buttons are
            // untouched), the same asymmetry `saveOwnerNote` enforces.
            disabled={atCap || draft !== null || saving}
          >
            <Plus aria-hidden className="size-3" />
            Add a note
          </Button>
        </div>
      </div>

      {atCap ? (
        <p className="text-muted-foreground text-xs">
          This agent is at its {MEMORY_MAX_NOTES}-note maximum. Delete a note to
          make room for another.
        </p>
      ) : null}

      <p className="text-muted-foreground text-xs">
        Changes take effect on this agent&apos;s next run.
      </p>
      <p className="text-muted-foreground text-xs">
        Turning off &quot;Remember what it learns&quot; doesn&apos;t erase these
        notes — this agent reads them on every run either way. Reads were never
        gated. Delete what it should forget.
      </p>

      {draft ? (
        <div className="bg-surface flex flex-col gap-3 rounded-lg border p-3">
          <div className="space-y-1.5">
            <Label htmlFor="agent-memory-key">Key</Label>
            <Input
              id="agent-memory-key"
              value={draft.key}
              maxLength={MEMORY_MAX_KEY_CHARS}
              // The key IS the note's identity — see `openEdit`.
              disabled={draft.editing || saving}
              {...keyStatus.controlProps}
              onChange={(e) => {
                setDraft({ ...draft, key: e.target.value });
                setKeyError(null);
              }}
            />
            <p id={KEY_HINT_ID} className="text-muted-foreground text-xs">
              A short label the agent can look this up by — lowercase, hyphens,
              no spaces.
            </p>
            <FieldStatus field={keyStatus} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agent-memory-value">Note</Label>
            <Input
              id="agent-memory-value"
              value={draft.value}
              maxLength={MEMORY_MAX_VALUE_CHARS}
              disabled={saving}
              {...valueStatus.controlProps}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                // Neither submit nor swallow — see the file's doc comment.
                e.preventDefault();
                setLineBreakDropped(true);
                setValueError(SINGLE_LINE_MESSAGE);
              }}
              onChange={(e) => {
                setDraft({ ...draft, value: e.target.value });
                setValueError(null);
                if (e.target.value === "") setLineBreakDropped(false);
              }}
            />
            <FieldStatus field={valueStatus} />
          </div>

          {saveError ? (
            <p role="alert" className="text-destructive text-xs">
              {saveError}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={closeForm}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {open ? (
        <div className="flex flex-col gap-2">
          {deleteError ? (
            <p role="alert" className="text-destructive text-xs">
              {deleteError}
            </p>
          ) : null}
          {loading ? (
            <p className="text-muted-foreground text-xs">Loading…</p>
          ) : loadError ? (
            // A failed read and an empty memory must never look the same —
            // the rule `AgentRunHistory` states for run history, for the same
            // reason: silence is what made every gotcha-70 failure invisible.
            <p role="alert" className="text-destructive text-xs">
              {loadError}
            </p>
          ) : (notes ?? []).length === 0 ? (
            <p className="text-muted-foreground text-xs">
              Nothing remembered yet. This agent adds notes as it works, and you
              can add your own.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {(notes ?? []).map((note) => (
                <li
                  key={note.id}
                  className="bg-surface hover:border-border-hover flex items-start gap-3 rounded-lg border p-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-mono text-xs font-medium">
                        {note.key}
                      </span>
                      {/* Colour is paired with words, never carrying the
                          meaning alone (WCAG AA). */}
                      <StatusPill
                        color={note.origin === "agent" ? "blue" : "gray"}
                        variant="soft"
                      >
                        {note.origin === "agent"
                          ? "Written by this agent"
                          : "Written by you"}
                      </StatusPill>
                    </div>
                    <span className="text-sm break-words">{note.value}</span>
                    <span className="text-muted-foreground text-xs">
                      {note.origin === "agent" && note.lastRunId
                        ? "Written on a run · "
                        : null}
                      {timeAgo(note.updatedAt)}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Edit ${note.key}`}
                    disabled={saving}
                    onClick={() => openEdit(note)}
                  >
                    <Pencil aria-hidden className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${note.key}`}
                    disabled={saving}
                    onClick={() => {
                      setDeleteError(null);
                      setConfirmDelete(note);
                    }}
                  >
                    <Trash2 aria-hidden className="text-destructive size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this note?</AlertDialogTitle>
            <AlertDialogDescription>
              This agent stops reading &quot;{confirmDelete?.key}&quot; from its
              next run onwards.
              {confirmDelete?.origin === "agent"
                ? " It wrote this one itself, and it can write it again."
                : " You wrote this one, so only you can put it back."}{" "}
              This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDeleteNote();
              }}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete note"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
