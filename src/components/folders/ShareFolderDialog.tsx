"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type RefObject,
} from "react";
import { ChevronDown, Link2, X } from "lucide-react";
import { toast } from "sonner";
import {
  inviteToFolder,
  leaveFolder,
  loadFolderAccess,
  revokeFolderInvitation,
  shareFolder,
  unshareFolder,
} from "@/lib/folders/sharing-actions";
import type {
  FolderAccessData,
  FolderLevel,
} from "@/lib/folders/sharing-types";
import { memberInitials } from "@/components/boards/cells/member-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_SUGGESTIONS = 6;

// A native <select>, like the board share dialog's access pickers.
function LevelSelect({
  label,
  value,
  onChange,
  disabled,
  focusKey,
}: {
  label: string;
  value: FolderLevel;
  onChange: (next: FolderLevel) => void;
  disabled: boolean;
  focusKey?: string;
}) {
  return (
    <div className="relative shrink-0">
      <select
        data-focus-key={focusKey}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as FolderLevel)}
        disabled={disabled}
        className={cn(
          "border-border bg-background text-foreground hover:bg-state-hover focus-visible:ring-ring/50 focus-visible:border-ring h-9 w-28 appearance-none rounded-md border pr-8 pl-3 text-sm transition-colors pointer-coarse:h-11",
          "focus-visible:ring-3 focus-visible:outline-none",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      >
        <option value="viewer">Viewer</option>
        <option value="editor">Editor</option>
      </select>
      <ChevronDown
        aria-hidden
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2"
      />
    </div>
  );
}

/**
 * Who a folder is shared with. Everything here is loaded when the dialog
 * opens and refreshed after each change through Server Actions: no
 * navigation, no router call.
 *
 * Concurrency: one action at a time (`busy`), and every async continuation
 * checks `epoch`, which changes whenever the dialog opens or closes, so a
 * response that lands after a close can neither write state nor count as a
 * change. Reads carry their own sequence number so an older answer never
 * replaces a newer one.
 */
export function ShareFolderDialog({
  folderId,
  folderName,
  open,
  onOpenChange,
  onChanged,
  returnFocusRef,
}: {
  folderId: string;
  folderName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once when the dialog closes after an action succeeded, so the
   *  page behind it can refresh its own copy (avatar stack, counts). */
  onChanged?: () => void;
  /** The control that opened the dialog; focus goes back to it on close. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const [data, setData] = useState<FolderAccessData | null>(null);
  const [query, setQuery] = useState("");
  const [newLevel, setNewLevel] = useState<FolderLevel>("viewer");
  const [error, setError] = useState<string | null>(null);
  // The error belongs to the name/email field (not to a row's own control).
  const [fieldInvalid, setFieldInvalid] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const activeKey = useRef<string | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const errorId = useId();

  const changed = useRef(false);
  const busy = useRef(false);
  const epoch = useRef(0);
  const loadSeq = useRef(0);

  // Disabling the control that has focus while an action runs drops focus to
  // <body>; when the action ends, put it back on the control that started it.
  useEffect(() => {
    if (pending || !activeKey.current) return;
    if (document.activeElement !== document.body) return;
    content.current
      ?.querySelector<HTMLElement>(`[data-focus-key="${activeKey.current}"]`)
      ?.focus();
  }, [pending]);

  async function reload(e: number) {
    const seq = ++loadSeq.current;
    const r = await loadFolderAccess({ folderId });
    if (e !== epoch.current || seq !== loadSeq.current) return;
    if (r.ok) setData(r.data);
    else setError(r.error);
  }

  useEffect(() => {
    if (!open) return;
    const e = ++epoch.current;
    busy.current = false;
    changed.current = false;
    start(() => reload(e));
    const orphan = epoch;
    const unbusy = busy;
    return () => {
      // Closing (or switching folder) orphans everything still in flight.
      orphan.current++;
      unbusy.current = false;
    };
    // `reload` closes over folderId only; re-running on open/folder is the intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, folderId]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      // Reset on close, so the next open starts clean (the dialog stays mounted).
      setError(null);
      setFieldInvalid(false);
      setNotice(null);
      setQuery("");
      if (changed.current) {
        changed.current = false;
        onChanged?.();
      }
    }
    onOpenChange(next);
  }

  /** Runs one action at a time; `task` gets the epoch it started in. */
  function exec(
    task: (e: number) => Promise<void>,
    { key = null }: { key?: string | null } = {},
  ) {
    if (busy.current) return;
    busy.current = true;
    const e = epoch.current;
    activeKey.current = key;
    setError(null);
    setFieldInvalid(false);
    setNotice(null);
    start(async () => {
      try {
        await task(e);
      } finally {
        if (e === epoch.current) busy.current = false;
      }
    });
  }

  function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    opts: { key?: string | null; field?: boolean } = {},
  ) {
    exec(async (e) => {
      const r = await action();
      if (e !== epoch.current) return;
      if (!r.ok) {
        setError(r.error ?? "Something went wrong. Please try again.");
        setFieldInvalid(opts.field ?? false);
        return;
      }
      changed.current = true;
      await reload(e);
    }, opts);
  }

  const trimmed = query.trim();
  const needle = trimmed.toLowerCase();
  const suggestions =
    data && needle.length > 0
      ? data.candidates
          .filter((c) => (c.fullName ?? "").toLowerCase().includes(needle))
          .slice(0, MAX_SUGGESTIONS)
      : [];

  function inviteEmail() {
    if (busy.current) return;
    if (!EMAIL.test(trimmed)) {
      setError("Enter a valid email address");
      setFieldInvalid(true);
      return;
    }
    exec(
      async (e) => {
        const r = await inviteToFolder({
          folderId,
          email: trimmed,
          level: newLevel,
        });
        if (e !== epoch.current) return;
        if (!r.ok) {
          setError(r.error);
          setFieldInvalid(true);
          return;
        }
        changed.current = true;
        setQuery("");
        setNotice(
          r.data.kind === "shared"
            ? "Added. They can open every board in this folder now."
            : r.data.emailSent
              ? "Invitation sent. They get access after they sign up and are approved."
              : "The invitation is saved, but we couldn't send the email. They'll get access when they sign up with this address and are approved. You can revoke it below.",
        );
        await reload(e);
      },
      { key: "invite" },
    );
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast("Link copied");
    } catch {
      toast("Couldn't copy the link");
    }
  }

  const canManage = data?.canManage ?? false;
  const iAmMember = !!data?.members.some((m) => m.userId === data.myUserId);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        ref={content}
        className="gap-4 sm:max-w-lg"
        onCloseAutoFocus={(ev) => {
          const el = returnFocusRef?.current;
          if (el) {
            ev.preventDefault();
            el.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Share {folderName}</DialogTitle>
          <DialogDescription>
            People you add can open every board in this folder, including boards
            added later.
          </DialogDescription>
        </DialogHeader>

        {canManage && (
          <div className="flex flex-col gap-2">
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                inviteEmail();
              }}
            >
              <Input
                data-focus-key="invite"
                aria-label="Name or email"
                placeholder="Name or email"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={pending}
                autoComplete="off"
                aria-invalid={fieldInvalid ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                className="min-w-0 flex-1"
              />
              <LevelSelect
                label="Access for new people"
                value={newLevel}
                onChange={setNewLevel}
                disabled={pending}
              />
              <Button
                type="submit"
                size="sm"
                disabled={pending || trimmed.length === 0}
              >
                Invite
              </Button>
            </form>
            {suggestions.length > 0 && (
              <ul className="bg-surface-muted/40 divide-border divide-y rounded-lg border">
                {suggestions.map((c) => {
                  const name = c.fullName ?? "Unknown member";
                  return (
                    <li
                      key={c.userId}
                      className="flex items-center gap-3 px-3 py-2"
                    >
                      <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                        {name}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Add ${name}`}
                        disabled={pending}
                        onClick={() => {
                          setQuery("");
                          run(
                            () =>
                              shareFolder({
                                folderId,
                                userId: c.userId,
                                level: newLevel,
                              }),
                            { key: "invite", field: true },
                          );
                        }}
                      >
                        Add
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {error ? (
          <p id={errorId} role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : notice ? (
          <p role="status" className="text-muted-foreground text-sm">
            {notice}
          </p>
        ) : null}

        {data === null ? (
          <p className="text-muted-foreground text-sm">Loading people…</p>
        ) : data.members.length === 0 && data.invitations.length === 0 ? (
          <p className="text-muted-foreground bg-surface-muted/40 rounded-lg border px-4 py-6 text-center text-sm">
            Nobody has been added to this folder yet. Each board is still shared
            on its own.
          </p>
        ) : (
          <ul className="bg-surface-muted/40 divide-border max-h-[min(50vh,20rem)] divide-y overflow-y-auto rounded-lg border">
            {data.members.map((m) => {
              const name = m.fullName ?? "Unknown member";
              return (
                <li
                  key={m.userId}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <Avatar aria-hidden className="size-8 border">
                    {m.avatarUrl ? (
                      <AvatarImage src={m.avatarUrl} alt="" />
                    ) : null}
                    <AvatarFallback className="bg-surface text-muted-foreground text-xs font-medium">
                      {memberInitials(name) || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
                    {name}
                    {m.userId === data.myUserId ? (
                      <span className="text-muted-foreground font-normal">
                        {" "}
                        (you)
                      </span>
                    ) : null}
                  </span>
                  {canManage ? (
                    <>
                      <LevelSelect
                        focusKey={`level:${m.userId}`}
                        label={`Access for ${name}`}
                        value={m.level}
                        onChange={(next) =>
                          run(
                            () =>
                              shareFolder({
                                folderId,
                                userId: m.userId,
                                level: next,
                              }),
                            { key: `level:${m.userId}` },
                          )
                        }
                        disabled={pending}
                      />
                      <Button
                        data-focus-key={`remove:${m.userId}`}
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${name}`}
                        disabled={pending}
                        onClick={() =>
                          run(
                            () => unshareFolder({ folderId, userId: m.userId }),
                            { key: `remove:${m.userId}` },
                          )
                        }
                      >
                        <X className="size-4" />
                      </Button>
                    </>
                  ) : (
                    <span className="text-muted-foreground text-xs">
                      {m.level === "editor" ? "Editor" : "Viewer"}
                    </span>
                  )}
                </li>
              );
            })}
            {data.invitations.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="text-foreground block truncate text-sm">
                    {i.email}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    <span>
                      {i.state === "awaiting_approval"
                        ? "Waiting for approval"
                        : "Invited"}
                    </span>
                    {" · "}
                    <span>{i.level === "editor" ? "Editor" : "Viewer"}</span>
                  </span>
                </span>
                <Button
                  data-focus-key={`revoke:${i.id}`}
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Revoke invitation for ${i.email}`}
                  disabled={pending}
                  onClick={() =>
                    run(
                      () =>
                        revokeFolderInvitation({
                          folderId,
                          invitationId: i.id,
                        }),
                      { key: `revoke:${i.id}` },
                    )
                  }
                >
                  <X className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {data?.membersTruncated ? (
          <p className="text-muted-foreground text-xs">
            The list is cut short. Only the first {data.members.length} people
            are shown.
          </p>
        ) : null}

        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="outline" size="sm" onClick={copyLink}>
            <Link2 className="size-4" /> Copy link
          </Button>
          {!canManage && iAmMember ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={pending}
              onClick={() =>
                exec(
                  async (e) => {
                    const r = await leaveFolder({ folderId });
                    if (e !== epoch.current) return;
                    if (!r.ok) {
                      // A failed leave is not a problem with the name/email field.
                      setError(r.error);
                      setFieldInvalid(false);
                      return;
                    }
                    changed.current = true;
                    handleOpenChange(false);
                  },
                  { key: "leave" },
                )
              }
            >
              Leave folder
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
