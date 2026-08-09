"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import type { ReportScope } from "@/lib/reports/queries";
import { setReportScope } from "@/lib/reports/actions";
import { showMutationError } from "@/lib/ui/mutation-toast";
import { selectClass } from "@/components/boards/automations/builder-utils";
import { Button } from "@/components/ui/button";

export type ScopeBoard = { id: string; name: string };
export type ScopePortfolio = { id: string; name: string };

/** The three scopes a user can actually pick. `template` is not one of them. */
type PickableScope = "board" | "boards" | "portfolio";

const SCOPE_LABEL: Record<PickableScope, string> = {
  board: "One board",
  boards: "Several boards",
  portfolio: "A portfolio",
};

/** Same set, in the order the `<select>` offers them. */
const SCOPE_ORDER: PickableScope[] = ["board", "boards", "portfolio"];

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/**
 * What a report covers: one board, an explicit set of boards, or a portfolio.
 *
 * THIS IS THE ONE CONTROL IN THE BUILDER THAT CHANGES SERVER DATA. Everything
 * else in the left rail edits the in-memory `ReportConfig` and re-renders the
 * preview from the payloads already in the browser — 0 round-trips (working
 * agreement #5). Re-binding the report changes which boards the server must
 * load, so this one commits through a Server Action and then asks the router to
 * re-run the page. It is deliberately an explicit "Apply" rather than an
 * on-change commit: a half-built board set must not fire three refetches.
 *
 * A `template`-scoped report binds no boards by construction, so it gets an
 * explanatory line instead of a picker.
 */
export function ReportScopePicker({
  reportId,
  scope,
  boardId,
  portfolioId,
  boundBoardIds,
  boards,
  portfolios,
  disabled = false,
}: {
  reportId: string;
  scope: ReportScope;
  /** Home board for `scope: "board"`. */
  boardId: string | null;
  portfolioId: string | null;
  /** Every board currently bound, resolved server-side. */
  boundBoardIds: string[];
  /** Boards this user may pick from (readable boards, name-sorted). */
  boards: ScopeBoard[];
  portfolios: ScopePortfolio[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const initialMode: PickableScope = scope === "template" ? "board" : scope;
  const [mode, setMode] = useState<PickableScope>(initialMode);
  const [draftBoardId, setDraftBoardId] = useState<string>(
    boardId ?? boundBoardIds[0] ?? boards[0]?.id ?? "",
  );
  const [draftBoardIds, setDraftBoardIds] = useState<string[]>(boundBoardIds);
  const [draftPortfolioId, setDraftPortfolioId] = useState<string>(
    portfolioId ?? portfolios[0]?.id ?? "",
  );

  function toggleBoard(id: string) {
    setDraftBoardIds((prev) =>
      prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id],
    );
  }

  // "Apply" is dead unless the draft is both VALID and DIFFERENT from what is
  // already stored — so the button never fires a no-op refetch.
  const changed = useMemo(() => {
    if (mode !== scope) return true;
    if (mode === "board") return draftBoardId !== boardId;
    if (mode === "portfolio") return draftPortfolioId !== portfolioId;
    return !sameSet(draftBoardIds, boundBoardIds);
  }, [
    mode,
    scope,
    draftBoardId,
    boardId,
    draftPortfolioId,
    portfolioId,
    draftBoardIds,
    boundBoardIds,
  ]);

  const valid =
    mode === "board"
      ? draftBoardId !== ""
      : mode === "boards"
        ? draftBoardIds.length > 0
        : draftPortfolioId !== "";

  function apply() {
    start(async () => {
      const res = await setReportScope(
        mode === "board"
          ? { reportId, scope: "board", boardId: draftBoardId }
          : mode === "boards"
            ? { reportId, scope: "boards", boardIds: draftBoardIds }
            : { reportId, scope: "portfolio", portfolioId: draftPortfolioId },
      );
      if (!res.ok) {
        showMutationError(
          "Couldn't change what this report covers.",
          new Error(res.error),
        );
        return;
      }
      // Scope IS server data: the set of boards the page loads just changed, so
      // this is the sanctioned RSC re-run — not an in-page toggle.
      router.refresh();
    });
  }

  if (scope === "template") {
    return (
      <p className="text-muted-foreground text-xs">
        This is an organization template. It stores a layout, not board data —
        start a new report from it to bind it to boards.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="text-sm">
        This report covers
        <select
          aria-label="Report scope"
          className={selectClass}
          value={mode}
          disabled={disabled}
          onChange={(e) => setMode(e.target.value as PickableScope)}
        >
          {SCOPE_ORDER.map((s) => (
            <option key={s} value={s}>
              {SCOPE_LABEL[s]}
            </option>
          ))}
        </select>
      </label>

      {mode === "board" ? (
        <label className="text-sm">
          Board
          <select
            aria-label="Board"
            className={selectClass}
            value={draftBoardId}
            disabled={disabled}
            onChange={(e) => setDraftBoardId(e.target.value)}
          >
            {boards.length === 0 ? <option value="">No boards</option> : null}
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {mode === "boards" ? (
        <fieldset className="min-w-0">
          <legend className="text-sm">Boards</legend>
          <div
            data-scroll-container
            className="bg-background mt-1 max-h-44 overflow-auto rounded-md border p-1.5"
          >
            {boards.length === 0 ? (
              <p className="text-muted-foreground px-1 py-1.5 text-xs">
                No boards you can read.
              </p>
            ) : (
              boards.map((b) => (
                <label
                  key={b.id}
                  className="hover:bg-state-hover flex items-center gap-2 rounded-md px-1 py-1 text-sm transition-colors"
                >
                  <input
                    type="checkbox"
                    className="accent-primary size-3.5 shrink-0"
                    checked={draftBoardIds.includes(b.id)}
                    disabled={disabled}
                    onChange={() => toggleBoard(b.id)}
                  />
                  <span className="min-w-0 flex-1 truncate">{b.name}</span>
                </label>
              ))
            )}
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            {draftBoardIds.length} selected. The report rolls these up and stays
            fixed to exactly this set.
          </p>
        </fieldset>
      ) : null}

      {mode === "portfolio" ? (
        <label className="text-sm">
          Portfolio
          <select
            aria-label="Portfolio"
            className={selectClass}
            value={draftPortfolioId}
            disabled={disabled}
            onChange={(e) => setDraftPortfolioId(e.target.value)}
          >
            {portfolios.length === 0 ? (
              <option value="">No portfolios</option>
            ) : null}
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="text-muted-foreground mt-1 block text-xs">
            The report follows the portfolio. Add a board to it and the next
            export includes that board — no edit here needed.
          </span>
        </label>
      ) : null}

      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="self-start"
        disabled={disabled || pending || !changed || !valid}
        onClick={apply}
      >
        <Check data-icon="inline-start" />
        {pending ? "Applying…" : "Apply scope"}
      </Button>
    </div>
  );
}
