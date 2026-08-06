"use client";

import { useRef, useState } from "react";
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

/** Hard cap on paragraph length — matches the `text` column's storage budget. */
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

  // A no-op save is still a save per the contract, but writing back an
  // identical value is pointless — fall back to onCancel when nothing
  // actually changed so an untouched open-then-close doesn't dirty the row.
  function commitOrCancel() {
    if (text === initial) {
      onCancel();
    } else {
      onCommit({ text });
    }
  }

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
              maxLength={CHAR_CAP}
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
                // Toolbar clicks must not blur the textarea — a blur would
                // collapse the selection applyMarkdown needs to act on.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runAction(action)}
              >
                <Icon />
              </Button>
            ))}
          </div>
          {showCounter && (
            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
              {text.length.toLocaleString()} / {CHAR_CAP.toLocaleString()}
            </span>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
