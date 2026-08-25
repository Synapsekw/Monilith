"use client";

import { useRef, useState } from "react";
import { FileText, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
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
  createDocument,
  deleteDocument,
  getDocumentBody,
  updateDocument,
} from "@/lib/agents/document-actions";
import {
  extractInBrowser,
  sourceFormatFor,
  EmptyExtractionError,
  type SourceFormat,
} from "@/lib/documents/extract-text";
import { extractSheetText } from "@/lib/documents/sheet-extract-actions";
import { estimateTokens } from "@/lib/agents/document-budget";
import type { AgentDocumentRow } from "@/lib/agents/documents-db";

type View = "list" | "form";

const SOURCE_LABELS: Record<SourceFormat, string> = {
  pasted: "Pasted",
  markdown: "Markdown",
  text: "Text",
  pdf: "PDF",
  docx: "Word",
  xlsx: "Spreadsheet",
};

function formatUpdatedAt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Reads a File as a base64 string (no `data:` prefix) — same
 *  FileReader-based approach as `UploadStep.tsx`'s `processFile`, the
 *  established pattern for getting bytes to a Server Action from the browser
 *  without pulling in a Buffer polyfill. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Read failed."));
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.replace(/^data:[^;]*;base64,/, ""));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Owner-facing library for reference documents: list, add (paste or
 * upload+extract), and delete. The one client boundary for this feature,
 * exactly like `AgentsSection`'s own view switch: list <-> form is plain
 * React state, never a `<Link>` or `router.push` — the documents were already
 * loaded by the server page, so toggling views costs 0 new server round trips
 * (working agreement #5 / gotcha-09). The live token count and all form
 * fields are client state too, recomputed from `estimateTokens` on every
 * keystroke rather than asking the server.
 *
 * Editing an existing document loads its body ON DEMAND, via
 * `getDocumentBody` — a single-document read, fetched only when the owner
 * deliberately opens ONE row. This does not violate the first-paint rule:
 * that rule is about `listDocumentsForOwner` never shipping 30 bodies to
 * render 30 titles, not about forbidding a body read altogether. The title
 * is filled in immediately from the row already in props (no fetch needed
 * for that half); the body arrives once the fetch resolves. Until it does,
 * `bodyLoaded` is false and the textarea + Save button stay disabled — an
 * owner who hits Save before (or during a failed) load cannot silently blank
 * out their document. A failed load renders inline (`loadError`) with a
 * Retry, never leaves the form in a "looks empty, will overwrite" state.
 *
 * A stale fetch is a SEPARATE hazard from an unfinished one: the owner can
 * leave a slow `openEdit` (Back/Cancel are never disabled — the load is not
 * allowed to trap them) and open a different document, or a fresh "create",
 * before the first fetch settles. `generationRef` is a counter bumped by
 * every `openCreate`/`openEdit`/`backToList` call; each in-flight
 * `getDocumentBody` continuation captures the generation it was started
 * under and checks it against the CURRENT generation before touching state.
 * A response that arrives after the owner has moved on is simply dropped —
 * it must never land in whatever document is open by the time it resolves.
 */
export function DocumentLibrary({
  documents,
  attachedBy,
}: {
  documents: AgentDocumentRow[];
  /** Document id -> the names of every agent that currently reads it, so a
   *  delete confirmation can say who is affected instead of deleting silently. */
  attachedBy: Record<string, string[]>;
}) {
  const [view, setView] = useState<View>("list");
  const [editingDoc, setEditingDoc] = useState<AgentDocumentRow | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sourceFormat, setSourceFormat] = useState<SourceFormat>("pasted");
  const [sourceFileName, setSourceFileName] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Whether `body` reflects a document actually loaded (or a fresh, empty
  // "create" form, where there's nothing to lose). False only while an
  // existing document's body is in flight or failed to load — Save is
  // disabled the whole time, so a load-in-progress or a failed load can
  // never be typed over and saved as an accidental blank-out.
  const [bodyLoaded, setBodyLoaded] = useState(true);
  const [loadingBody, setLoadingBody] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Bumped by every `openCreate`/`openEdit`/`backToList` — the "which session
  // is this" counter an in-flight `getDocumentBody` continuation checks
  // itself against before touching state. See the file-level doc comment.
  const generationRef = useRef(0);

  function openCreate() {
    generationRef.current += 1;
    setEditingDoc(null);
    setTitle("");
    setBody("");
    setSourceFormat("pasted");
    setSourceFileName(null);
    setExtractError(null);
    setTitleError(null);
    setSaveError(null);
    setBodyLoaded(true);
    setLoadingBody(false);
    setLoadError(null);
    setView("form");
  }

  /** Opens an existing document for editing. The title is filled in
   *  immediately from the row already in props — no fetch needed for that
   *  half. The body is fetched ON DEMAND via `getDocumentBody`, exactly one
   *  document, only because the owner just asked to open exactly this one
   *  (never on first paint, never for the whole library).
   *
   *  `myGeneration` pins this call to the session it started under. If the
   *  owner leaves (Back/Cancel/another `openEdit`/`openCreate`) before this
   *  resolves, `generationRef.current` has moved on by the time the promise
   *  settles, and every branch below (including `finally`) becomes a no-op —
   *  the response is dropped instead of landing in whatever is open by then. */
  async function openEdit(doc: AgentDocumentRow) {
    const myGeneration = (generationRef.current += 1);
    setEditingDoc(doc);
    setTitle(doc.title);
    setBody("");
    setSourceFormat("pasted");
    setSourceFileName(null);
    setExtractError(null);
    setTitleError(null);
    setSaveError(null);
    setBodyLoaded(false);
    setLoadError(null);
    setView("form");
    setLoadingBody(true);
    try {
      const res = await getDocumentBody(doc.id);
      if (generationRef.current !== myGeneration) return; // stale: moved on
      if (!res.ok) {
        setLoadError(res.error);
        return;
      }
      setBody(res.data.body);
      setBodyLoaded(true);
    } catch {
      if (generationRef.current !== myGeneration) return; // stale: moved on
      setLoadError("Couldn't load that document.");
    } finally {
      if (generationRef.current === myGeneration) setLoadingBody(false);
    }
  }

  function retryLoad() {
    if (editingDoc) openEdit(editingDoc);
  }

  function backToList() {
    generationRef.current += 1;
    setView("list");
    setEditingDoc(null);
    setLoadingBody(false);
    setLoadError(null);
    setBodyLoaded(true);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setExtractError(null);
    setExtracting(true);
    try {
      const format = sourceFormatFor(file.name);
      if (format === "xlsx") {
        const bytes = await fileToBase64(file);
        const res = await extractSheetText({ fileName: file.name, bytes });
        if (!res.ok) {
          setExtractError(res.error);
          return;
        }
        setBody(res.data.text);
        setSourceFormat("xlsx");
        setSourceFileName(file.name);
      } else {
        const extracted = await extractInBrowser(file);
        setBody(extracted.text);
        setSourceFormat(extracted.format);
        setSourceFileName(file.name);
      }
    } catch (err) {
      setExtractError(
        err instanceof EmptyExtractionError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Couldn't read that file.",
      );
    } finally {
      setExtracting(false);
      e.target.value = "";
    }
  }

  async function handleSave() {
    setSaveError(null);
    // Belt-and-suspenders alongside the disabled Save button: an edit whose
    // body never finished loading (or failed to) must never be saved over —
    // that would silently blank out the document. `bodyLoaded` is true for a
    // fresh "create" form (nothing to lose there), so this only blocks the
    // edit path.
    if (editingDoc && !bodyLoaded) {
      setSaveError("Wait for the document to finish loading before saving.");
      return;
    }
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setTitleError("Give it a title.");
      return;
    }
    if (!body.trim()) {
      setSaveError("A document can't be empty.");
      return;
    }
    setTitleError(null);
    setSaving(true);
    try {
      if (editingDoc) {
        const res = await updateDocument({
          id: editingDoc.id,
          title: trimmedTitle,
          body,
        });
        if (!res.ok) {
          setSaveError(res.error);
          return;
        }
      } else {
        const res = await createDocument({
          title: trimmedTitle,
          body,
          sourceFormat,
          sourceFileName,
        });
        if (!res.ok) {
          setSaveError(res.error);
          return;
        }
      }
      backToList();
    } finally {
      setSaving(false);
    }
  }

  function requestDelete(id: string) {
    setDeleteError(null);
    setConfirmDeleteId(id);
  }

  async function confirmDelete() {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      const res = await deleteDocument(confirmDeleteId);
      if (!res.ok) {
        setDeleteError(res.error);
        return;
      }
      setConfirmDeleteId(null);
    } finally {
      setDeleting(false);
    }
  }

  const affectedAgents = confirmDeleteId
    ? (attachedBy[confirmDeleteId] ?? [])
    : [];

  if (view === "form") {
    return (
      <div className="flex flex-col gap-4">
        {/* Deliberately NOT disabled by `loadingBody` — trapping the owner
            behind a slow fetch is worse than letting them leave. `backToList`
            bumps `generationRef`, which is what actually makes a load the
            owner walked away from harmless once it resolves. */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={backToList}
          disabled={saving}
          className="w-fit"
        >
          Back
        </Button>

        <div className="space-y-1.5">
          <Label htmlFor="doc-title">Title</Label>
          <Input
            id="doc-title"
            value={title}
            disabled={saving}
            aria-invalid={Boolean(titleError)}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleError(null);
            }}
          />
          {titleError ? (
            <p className="text-destructive text-xs">{titleError}</p>
          ) : null}
        </div>

        {loadingBody ? (
          <p className="text-muted-foreground text-xs">Loading document…</p>
        ) : null}
        {loadError ? (
          <div className="flex items-center gap-2">
            <p role="alert" className="text-destructive text-xs">
              {loadError}
            </p>
            <Button type="button" variant="ghost" size="xs" onClick={retryLoad}>
              Retry
            </Button>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="doc-upload">Upload</Label>
          <input
            id="doc-upload"
            type="file"
            accept=".md,.markdown,.txt,.pdf,.docx,.xlsx"
            disabled={extracting || saving || loadingBody || !bodyLoaded}
            onChange={handleFileChange}
            className="text-muted-foreground file:text-foreground file:bg-surface-muted hover:file:bg-accent w-full text-sm file:mr-3 file:cursor-pointer file:rounded-lg file:border file:px-2.5 file:py-1 file:text-sm file:font-medium"
          />
          <p className="text-muted-foreground text-xs">
            PDF extraction is lossy — column order, tables and headers
            frequently mangle. Check the text before saving.
          </p>
          {extracting ? (
            <p className="text-muted-foreground text-xs">Reading file…</p>
          ) : null}
          {extractError ? (
            <p role="alert" className="text-destructive text-xs">
              {extractError}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="doc-content">Content</Label>
            <span className="text-muted-foreground text-xs">
              {estimateTokens(body)} tokens
            </span>
          </div>
          <Textarea
            id="doc-content"
            rows={12}
            value={body}
            disabled={
              saving || loadingBody || (editingDoc !== null && !bodyLoaded)
            }
            onChange={(e) => setBody(e.target.value)}
            placeholder="Paste text, or upload a file above to extract it here. Review it before saving — this is exactly what gets injected into a prompt."
          />
          <p className="text-muted-foreground text-xs">
            What&apos;s here is byte-for-byte what gets saved.
          </p>
        </div>

        {saveError ? (
          <p role="alert" className="text-destructive text-sm">
            {saveError}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={saving || (editingDoc !== null && !bodyLoaded)}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={backToList}
            disabled={saving}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {documents.length} {documents.length === 1 ? "document" : "documents"}
        </p>
        <Button type="button" size="sm" onClick={openCreate}>
          <Plus aria-hidden className="size-4" />
          Add document
        </Button>
      </div>

      {deleteError ? (
        <p role="alert" className="text-destructive text-sm">
          {deleteError}
        </p>
      ) : null}

      {documents.length === 0 ? (
        <EmptyState>
          No reference documents yet. Add one to give your agents context they
          can&apos;t get from your boards.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="bg-surface hover:border-border-hover flex items-center justify-between gap-3 rounded-lg border p-3"
            >
              <button
                type="button"
                onClick={() => openEdit(doc)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <FileText
                  aria-hidden
                  className="text-muted-foreground size-4 shrink-0"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{doc.title}</span>
                  <span className="text-muted-foreground text-xs">
                    {doc.tokenEstimate} tokens ·{" "}
                    {SOURCE_LABELS[doc.sourceFormat]}
                    {" · "}
                    {formatUpdatedAt(doc.updatedAt)}
                  </span>
                </span>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${doc.title}`}
                onClick={() => requestDelete(doc.id)}
              >
                <Trash2 aria-hidden className="text-destructive size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this document?</AlertDialogTitle>
            <AlertDialogDescription>
              {affectedAgents.length > 0
                ? `${new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(affectedAgents)} ${affectedAgents.length === 1 ? "reads" : "read"} this document. Deleting it removes that context from ${affectedAgents.length === 1 ? "that agent" : "those agents"} immediately. This can't be undone.`
                : "No agent currently reads this document. This can't be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete document"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
