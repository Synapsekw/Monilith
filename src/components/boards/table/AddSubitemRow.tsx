"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import type { CellControls } from "./shared";

/** Inline input row appended to the expanded subitem block. */
export function AddSubitemRow({
  parentId,
  controls,
}: {
  parentId: string;
  controls: CellControls;
}) {
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  // After a successful add, refocus this input so the user can type the next
  // subitem and commit it with Enter alone. The input is disabled mid-flight
  // (which blurs it), so we wait for the transition to settle before refocusing.
  const refocusAfterAdd = useRef(false);
  useEffect(() => {
    if (!isPending && refocusAfterAdd.current) {
      refocusAfterAdd.current = false;
      inputRef.current?.focus();
    }
  }, [isPending]);
  function commit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(() =>
      controls.addSubitem(parentId, trimmed, {
        onSuccess: () => {
          // The name is already set from what the user typed — do NOT drop the
          // new row into rename mode (that required a second Enter to dismiss).
          setName("");
          refocusAfterAdd.current = true;
        },
      }),
    );
  }
  return (
    <div className="bg-surface-sunken sticky left-0 flex items-center gap-2 border-b py-1.5 pr-4 pl-12">
      <Plus className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        disabled={isPending}
        placeholder="Add subitem"
        aria-label="Add subitem"
        className="text-foreground placeholder:text-muted-foreground w-full bg-transparent text-sm outline-none disabled:opacity-50"
      />
    </div>
  );
}
