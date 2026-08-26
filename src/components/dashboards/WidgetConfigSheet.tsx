"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { useRestoreFocusAfterPending } from "@/lib/hooks/use-restore-focus-after-pending";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  WidgetConfigForm,
  defaultConfig,
  type BoardOption,
  type WidgetDraft,
} from "@/components/dashboards/WidgetConfigForm";
import { NumberWidget } from "@/components/dashboards/widgets/NumberWidget";
import { LazyChartWidget } from "@/components/dashboards/widgets/LazyChartWidget";
import { BatteryWidget } from "@/components/dashboards/widgets/BatteryWidget";
import { CompletionWidget } from "@/components/dashboards/widgets/CompletionWidget";
import { HealthWidget } from "@/components/dashboards/widgets/HealthWidget";
import { ListWidget } from "@/components/dashboards/widgets/ListWidget";
import { Kicker } from "@/components/ui/kicker";
import { normalizeChartConfig } from "@/lib/dashboards/chart-config";
import { WidgetPreviewProvider } from "@/lib/dashboards/use-widget-preview";
import { useDashboardMutations } from "@/lib/dashboards/use-dashboard-mutations";
import type { CacheWidget } from "@/lib/dashboards/cache";
import { widgetKindSchema } from "@/lib/validations/dashboards";

function draftFromWidget(w: CacheWidget): WidgetDraft {
  const config =
    w.kind === "chart"
      ? (normalizeChartConfig(
          (w.config ?? {}) as Record<string, unknown>,
        ) as unknown as Record<string, unknown>)
      : ((w.config ?? {}) as Record<string, unknown>);
  // The DB enum can be ahead of this build (a widget kind added by a newer
  // migration before its UI ships here). Validate at the boundary; an
  // unrecognized kind degrades to a "number" draft instead of a type hole.
  const kind = widgetKindSchema.safeParse(w.kind);
  return {
    kind: kind.success ? kind.data : "number",
    sourceBoardId: w.source_board_id ?? "",
    title: w.title ?? "",
    config,
  };
}

function initialDraft(
  target: CacheWidget | undefined,
  boards: BoardOption[],
): WidgetDraft {
  return target
    ? draftFromWidget(target)
    : {
        kind: "number",
        sourceBoardId: boards[0]?.id ?? "",
        title: "",
        config: defaultConfig("number"),
      };
}

/**
 * Inner form — remounted each time the sheet opens (key=`${open}-${target?.id}`)
 * so useState initializers always reflect the current target without any
 * synchronous setState-in-effect calls (react-hooks/set-state-in-effect).
 */
function WidgetConfigSheetForm({
  dashboardId,
  boards,
  onClose,
  editWidget: target,
}: {
  dashboardId: string;
  boards: BoardOption[];
  onClose: () => void;
  editWidget?: CacheWidget;
}) {
  const { addWidget, editWidget } = useDashboardMutations(dashboardId);
  const [draft, setDraft] = useState<WidgetDraft>(() =>
    initialDraft(target, boards),
  );
  const [error, setError] = useState<string | null>(null);

  // Debounce the draft → preview config so typing/picking doesn't spam queries.
  const [previewCfg, setPreviewCfg] = useState(draft.config);
  useEffect(() => {
    const t = setTimeout(() => setPreviewCfg(draft.config), 400);
    return () => clearTimeout(t);
  }, [draft.config]);

  const previewWidget = useMemo(
    () =>
      ({
        id: target?.id ?? "__preview__",
        kind: draft.kind,
        source_board_id: draft.sourceBoardId || null,
        title: draft.title,
        config: previewCfg,
      }) as CacheWidget,
    [target?.id, draft.kind, draft.sourceBoardId, draft.title, previewCfg],
  );

  function save() {
    setError(null);
    if (!draft.sourceBoardId) return setError("Pick a source board.");
    if (target) {
      editWidget.mutate(
        {
          widgetId: target.id,
          title: draft.title,
          sourceBoardId: draft.sourceBoardId,
          config: draft.config,
        },
        {
          onSuccess: () => onClose(),
          onError: (e) => setError(e.message),
        },
      );
    } else {
      addWidget.mutate(
        {
          kind: draft.kind,
          sourceBoardId: draft.sourceBoardId,
          title: draft.title,
          config: draft.config,
        },
        {
          onSuccess: () => onClose(),
          onError: (e) => setError(e.message),
        },
      );
    }
  }

  const pending = addWidget.isPending || editWidget.isPending;
  // Save unmounts this form on success; on failure it stays open with the
  // button re-enabled, which is the case that needs its focus back.
  const saveRef = useRestoreFocusAfterPending<HTMLButtonElement>(pending);

  return (
    <>
      <div
        data-scroll-container
        className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto py-4 md:grid-cols-[1fr_1.1fr]"
      >
        <WidgetConfigForm boards={boards} value={draft} onChange={setDraft} />
        <div className="flex flex-col gap-2">
          <Kicker>Live preview</Kicker>
          <div className="bg-card relative h-64 rounded-[14px] border p-3">
            <WidgetPreviewProvider
              previewWidgetId={previewWidget.id}
              kind={draft.kind}
              sourceBoardId={draft.sourceBoardId}
              config={previewCfg}
            >
              {draft.kind === "number" ? (
                <NumberWidget widget={previewWidget} />
              ) : draft.kind === "chart" ? (
                <LazyChartWidget widget={previewWidget} />
              ) : draft.kind === "battery" ? (
                <BatteryWidget widget={previewWidget} />
              ) : draft.kind === "completion" ? (
                <CompletionWidget widget={previewWidget} />
              ) : draft.kind === "health" ? (
                <HealthWidget widget={previewWidget} />
              ) : (
                <ListWidget widget={previewWidget} />
              )}
            </WidgetPreviewProvider>
          </div>
        </div>
      </div>
      {/* Form-level save error (a failed mutation, or "no source board" when
          the workspace has none) — it belongs to the whole sheet, not to one
          control, so it is an alert rather than a field description. */}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2 border-t pt-4">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button ref={saveRef} onClick={save} disabled={pending}>
          {target ? "Save" : "Add widget"}
        </Button>
      </div>
    </>
  );
}

export function WidgetConfigSheet({
  dashboardId,
  boards,
  open,
  onOpenChange,
  editWidget: target,
}: {
  dashboardId: string;
  boards: BoardOption[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editWidget?: CacheWidget;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{target ? "Edit widget" : "Add a widget"}</SheetTitle>
        </SheetHeader>
        {/* Remount the form when the sheet opens or switches target so its
            useState initializers always read the current config — same pattern
            as EditListWidgetDialog — avoiding setState-in-effect. */}
        {open ? (
          <WidgetConfigSheetForm
            key={`${target?.id ?? "new"}`}
            dashboardId={dashboardId}
            boards={boards}
            onClose={() => onOpenChange(false)}
            editWidget={target}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
