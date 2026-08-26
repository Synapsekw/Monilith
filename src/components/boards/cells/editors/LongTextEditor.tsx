"use client";

import { useEffect, useId, useRef, useState } from "react";
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
import { useFieldStatus } from "@/components/ui/field-status";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  /** Keyboard shortcut shown in the tooltip — only bold/italic have one. */
  shortcut?: string;
}[] = [
  { action: "bold", label: "Bold", icon: Bold, shortcut: "⌘B" },
  { action: "italic", label: "Italic", icon: Italic, shortcut: "⌘I" },
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

  // WAI-ARIA APG tabs pattern plumbing. There is only ever ONE tabpanel in
  // the DOM at a time — the Preview tab unmounts the textarea and the Write
  // tab unmounts the preview (see the component doc comment) — so both tabs
  // share the same `aria-controls` target; the panel's `aria-labelledby`
  // is what actually tracks which tab currently "owns" it.
  const panelId = useId();
  const writeTabId = `${panelId}-write-tab`;
  const previewTabId = `${panelId}-preview-tab`;
  const writeTabRef = useRef<HTMLButtonElement>(null);
  const previewTabRef = useRef<HTMLButtonElement>(null);

  // Roving tabindex + Left/Right arrow switching (APG "automatic activation"
  // tabs pattern). Only two tabs exist, so either arrow key just toggles.
  function handleTabKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = tab === "write" ? "preview" : "write";
    setTab(next);
    (next === "write" ? writeTabRef : previewTabRef).current?.focus();
  }

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
  // The over-cap line is the reason Save is refusing, so it has to be the
  // textarea's accessible description — `aria-invalid` on its own says
  // "wrong" without saying by how much.
  const capStatus = useFieldStatus(
    isOverCap
      ? `${overBy.toLocaleString()} characters over the ${CHAR_CAP.toLocaleString()} limit — shorten to save.`
      : null,
  );

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
  //
  // THIS CLEANUP MUST DO NOTHING WHEN NOTHING WAS TYPED, and must not settle
  // the guard in that case. React StrictMode double-invokes effects on mount
  // (setup → cleanup → setup) and the App Router runs in StrictMode in dev
  // whenever next.config.ts leaves `reactStrictMode` unset — which it does, so
  // Next resolves __NEXT_STRICT_MODE_APP to true. That means this cleanup runs
  // once immediately after mount, before the user can type. An earlier version
  // called onCancel there and set `settled`, which broke the panel two ways:
  // the parent cleared its editing state and the panel closed the instant it
  // opened (clicking a text cell appeared to do nothing at all), and the
  // latched guard then made the real unmount a no-op, silently reinstating the
  // data loss this effect exists to prevent.
  //
  // Trade-off, deliberate: unmounting an untouched panel now leaves the
  // parent's `editing` pointing at this cell, so scrolling the row back into
  // view reopens the panel. That is harmless — no data is involved, and the
  // user never dismissed it — and clicking any other cell resets it.
  useEffect(() => {
    return () => {
      if (settled.current) return;
      const finalText = latestText.current;
      // Untouched: nothing to save, and calling back here is what StrictMode
      // turns into a self-closing panel. Leave `settled` armed for the real
      // unmount.
      if (finalText === initialRef.current) return;
      // Over the cap we cannot commit (the value would exceed the schema's
      // 20,000-char bound) and there is no panel left to show the blocking
      // message on an implicit unmount, so the edit is lost — the same
      // accepted gap textValueSchema's comment documents for the
      // spreadsheet-import path. Settle so nothing else fires.
      settled.current = true;
      if (finalText.length > CHAR_CAP) return;
      onCommitRef.current({ text: finalText });
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
              ref={writeTabRef}
              type="button"
              id={writeTabId}
              role="tab"
              aria-selected={tab === "write"}
              aria-controls={panelId}
              tabIndex={tab === "write" ? 0 : -1}
              onClick={() => setTab("write")}
              onKeyDown={handleTabKeyDown}
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
              ref={previewTabRef}
              type="button"
              id={previewTabId}
              role="tab"
              aria-selected={tab === "preview"}
              aria-controls={panelId}
              tabIndex={tab === "preview" ? 0 : -1}
              onClick={() => setTab("preview")}
              onKeyDown={handleTabKeyDown}
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
            <div id={panelId} role="tabpanel" aria-labelledby={writeTabId}>
              <Textarea
                ref={textareaRef}
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                {...capStatus.controlProps}
                className="max-h-[min(24rem,var(--radix-popover-content-available-height))] min-h-[12rem] resize-none overflow-y-auto"
              />
            </div>
          ) : (
            <div
              id={panelId}
              role="tabpanel"
              aria-labelledby={previewTabId}
              className="max-h-[min(24rem,var(--radix-popover-content-available-height))] min-h-[12rem] overflow-y-auto py-1"
            >
              <MarkdownPreview markdown={text} />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-2 py-1.5">
          <div className="flex items-center gap-0.5">
            {TOOLBAR_ACTIONS.map(({ action, label, icon: Icon, shortcut }) => (
              <Tooltip key={action}>
                <TooltipTrigger asChild>
                  <Button
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
                </TooltipTrigger>
                <TooltipContent>
                  {shortcut ? `${label} (${shortcut})` : label}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
          {capStatus.message ? (
            <p
              {...capStatus.messageProps}
              className="text-destructive min-w-0 flex-1 text-right text-xs leading-snug"
            >
              {capStatus.message}
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
