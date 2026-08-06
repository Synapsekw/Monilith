"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bold,
  Code,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { MarkdownAction } from "@/lib/boards/markdown";
import { applyMarkdown } from "@/lib/boards/markdown";
import { MarkdownPreview } from "./MarkdownPreview";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Cap on paragraph length — matches `textValueSchema`'s storage budget
 * (`src/lib/validations/boards.ts`). Not enforced as a hard input limit
 * (no `maxLength` on the textarea): a paste that lands over this is kept
 * on screen in full and the commit is blocked with an inline message
 * instead, so nothing is silently truncated.
 */
const CHAR_CAP = 20_000;
/** The counter only earns its place in the footer once the cap is close enough to matter. */
const COUNTER_THRESHOLD = 19_000;

const TOOLBAR_ACTIONS: {
  action: MarkdownAction;
  label: string;
  icon: LucideIcon;
}[] = [
  { action: "bold", label: "Bold", icon: Bold },
  { action: "italic", label: "Italic", icon: Italic },
  { action: "strikethrough", label: "Strikethrough", icon: Strikethrough },
  { action: "heading", label: "Heading", icon: Heading2 },
  { action: "bulletList", label: "Bullet list", icon: List },
  { action: "numberedList", label: "Numbered list", icon: ListOrdered },
  { action: "link", label: "Link", icon: Link2 },
  { action: "inlineCode", label: "Inline code", icon: Code },
  { action: "quote", label: "Quote", icon: Quote },
];

type LongTextEditorProps = {
  value: { text: string } | null;
  settings: Record<string, unknown>;
  onCommit: (value: { text: string }) => void;
  onCancel: () => void;
  /** Shown in the panel header so the user knows which field they're editing. */
  columnName?: string;
};

/**
 * The expanded editor for board `text` cells — an anchored popover with a
 * Write/Preview toolbar for composing Markdown paragraphs, opened from a
 * text cell (Task 5 wires the trigger). Built on the same `PopoverSurface`
 * shape as the other cell editors (`editors/index.tsx`): a Radix Popover
 * anchored to the cell, portalled past the board's nested scroll
 * containers, with edge-collision flipping handled by Radix.
 *
 * `text` lives here (not in the textarea DOM node) because the Preview tab
 * unmounts the textarea entirely — the value has to survive that swap.
 *
 * Every exit path is event-driven (Escape, outside click, the close button,
 * Cmd/Ctrl+Enter) *except* one: `GroupSection`'s row virtualization can
 * unmount this panel out from under an in-progress edit (overscan is only 6
 * rows) with none of those events ever firing. The cleanup effect below
 * covers that case — it commits the latest text on unmount unless an exit
 * path already did, so scrolling never silently destroys a draft.
 */
export function LongTextEditor({
  value,
  onCommit,
  onCancel,
  columnName,
}: LongTextEditorProps): React.JSX.Element {
  const initial = value?.text ?? "";
  const [text, setText] = useState(initial);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Mirrors of the latest render's text/callbacks/initial value, read from
  // the unmount effect below. A `useEffect` cleanup with an empty deps array
  // closes over whatever these were at MOUNT time, which would go stale the
  // moment the user typed a second character — refs keep it current instead.
  // Written from an effect (not directly in the render body) per
  // react-hooks/refs: a ref write has to happen outside of render.
  const latestText = useRef(text);
  const onCommitRef = useRef(onCommit);
  const onCancelRef = useRef(onCancel);
  const initialRef = useRef(initial);
  useEffect(() => {
    latestText.current = text;
    onCommitRef.current = onCommit;
    onCancelRef.current = onCancel;
    initialRef.current = initial;
  });
  // Guards against double-committing: set true the moment any exit path
  // (Escape, outside click, close button, Cmd/Ctrl+Enter) resolves the
  // panel, so the unmount cleanup below knows not to act again.
  const settled = useRef(false);

  const overBy = text.length - CHAR_CAP;
  const isOverCap = overBy > 0;

  // A no-op save is still a save per the contract, but writing back an
  // identical value is pointless — fall back to onCancel when nothing
  // actually changed so an untouched open-then-close doesn't dirty the row.
  //
  // Over the cap, this deliberately does nothing: no onCommit (would save
  // oversized/invalid data), no onCancel (would silently discard the user's
  // work). `Popover`'s `open` prop above is hardcoded `true`, not read from
  // state, so leaving both uncalled is what keeps the panel open — nothing
  // else in this component removes it from the tree. The footer surfaces
  // the blocking reason so the user can edit the text back under the cap
  // and retry.
  function commitOrCancel() {
    if (isOverCap) return;
    settled.current = true;
    if (text === initial) {
      onCancel();
    } else {
      onCommit({ text });
    }
  }

  // Covers the one exit path that isn't event-driven: GroupSection virtualizes
  // rows (overscan: 6), so scrolling can unmount this panel mid-edit without
  // Escape/outside-click/close ever firing — see the component doc comment.
  useEffect(() => {
    return () => {
      if (settled.current) return;
      const finalText = latestText.current;
      settled.current = true;
      if (finalText.length > CHAR_CAP) {
        // Can't commit an over-cap value here (would save data past the
        // schema's 20,000-char bound) and there's no panel left to show the
        // blocking message on an implicit unmount — the edit is lost, the
        // same accepted gap textValueSchema's comment documents for the
        // spreadsheet-import path. Still call onCancel rather than doing
        // nothing, though: it doesn't write anything, and it clears the
        // parent's editing state — skipping it would leave that state
        // pointing at this cell, and scrolling back to the row would
        // spontaneously reopen the panel.
        onCancelRef.current();
        return;
      }
      if (finalText === initialRef.current) {
        onCancelRef.current();
      } else {
        onCommitRef.current({ text: finalText });
      }
    };
  }, []);

  function runAction(action: MarkdownAction) {
    const ta = textareaRef.current;
    if (!ta) return;
    const result = applyMarkdown(
      text,
      ta.selectionStart,
      ta.selectionEnd,
      action,
    );
    setText(result.text);
    // The textarea's value updates on the next render; the selection can
    // only be restored once that DOM write has landed, hence the rAF.
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(result.selStart, result.selEnd);
    });
  }

  // Enter/Escape here deliberately do NOT follow `useCommitKeys`
  // (editors/index.tsx), which binds Enter -> commit and Escape -> cancel.
  // A long-text paragraph needs Enter to insert a newline while drafting,
  // and losing a paragraph to a stray Escape is worse than a harmless save
  // — so Escape SAVES (handled below, via PopoverContent's
  // onEscapeKeyDown) and only Cmd/Ctrl+Enter commits from the keyboard.
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "Enter") {
      e.preventDefault();
      commitOrCancel();
      return;
    }
    if (mod && e.key.toLowerCase() === "b") {
      e.preventDefault();
      runAction("bold");
      return;
    }
    if (mod && e.key.toLowerCase() === "i") {
      e.preventDefault();
      runAction("italic");
    }
    // Plain Enter falls through untouched — the textarea's native behavior
    // inserts a newline, which is exactly what we want.
  }

  const showCounter = text.length > COUNTER_THRESHOLD;

  return (
    <Popover
      open
      onOpenChange={(next) => {
        // Outside click / any dismissal Radix initiates on its own (not the
        // Escape path below, which is intercepted before it gets here).
        if (!next) commitOrCancel();
      }}
    >
      {/* Anchors the floating surface to the cell it edits. */}
      <PopoverAnchor className="absolute inset-0" aria-hidden />
      <PopoverContent
        align="start"
        sideOffset={4}
        aria-label={columnName ? `Edit ${columnName}` : "Edit text"}
        className="flex w-[min(36rem,var(--radix-popover-content-available-width))] flex-col overflow-hidden p-0"
        onEscapeKeyDown={(e) => {
          // Handled here — rather than letting Radix's default dismiss run
          // and call onOpenChange(false) above — so the commit fires
          // exactly once instead of racing the dismiss layer's own close.
          e.preventDefault();
          commitOrCancel();
        }}
      >
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
            {columnName}
          </span>
          <div
            role="tablist"
            aria-label="View"
            className="bg-surface-muted flex items-center gap-0.5 rounded-sm p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === "write"}
              onClick={() => setTab("write")}
              className={cn(
                "rounded-sm px-2 py-1 text-xs font-medium transition-colors",
                tab === "write"
                  ? "bg-state-selected text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Write
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "preview"}
              onClick={() => setTab("preview")}
              className={cn(
                "rounded-sm px-2 py-1 text-xs font-medium transition-colors",
                tab === "preview"
                  ? "bg-state-selected text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Preview
            </button>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            onClick={commitOrCancel}
          >
            <X />
          </Button>
        </div>

        <div className="px-3 py-2">
          {tab === "write" ? (
            <Textarea
              ref={textareaRef}
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              aria-invalid={isOverCap}
              className="max-h-[min(24rem,var(--radix-popover-content-available-height))] min-h-[12rem] resize-none overflow-y-auto"
            />
          ) : (
            <div className="max-h-[min(24rem,var(--radix-popover-content-available-height))] min-h-[12rem] overflow-y-auto py-1">
              <MarkdownPreview markdown={text} />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-2 py-1.5">
          <div className="flex items-center gap-0.5">
            {TOOLBAR_ACTIONS.map(({ action, label, icon: Icon }) => (
              <Button
                key={action}
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={label}
                // The Preview tab unmounts the textarea, so every action
                // here would silently no-op (`runAction` bails when the ref
                // is null) — disable rather than let nine dead buttons sit
                // there looking clickable.
                disabled={tab === "preview"}
                // Toolbar clicks must not blur the textarea — a blur would
                // collapse the selection applyMarkdown needs to act on.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runAction(action)}
              >
                <Icon />
              </Button>
            ))}
          </div>
          {isOverCap ? (
            <p
              role="alert"
              className="text-destructive min-w-0 flex-1 text-right text-xs leading-snug"
            >
              {overBy.toLocaleString()} characters over the{" "}
              {CHAR_CAP.toLocaleString()} limit — shorten to save.
            </p>
          ) : (
            showCounter && (
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {text.length.toLocaleString()} / {CHAR_CAP.toLocaleString()}
              </span>
            )
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
