"use client";

import { useState } from "react";
import {
  ArrowDownUp,
  ArrowDown,
  ArrowUp,
  Check,
  ListFilter,
  Search,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FilterBuilder } from "@/components/dashboards/FilterBuilder";
import type { HeaderMember } from "@/components/boards/BoardHeader";
import type { CacheColumn } from "@/lib/boards/cache";
import type { ColumnOption } from "@/lib/validations/boards";
import type { SortField } from "@/lib/boards/board-filter";
import { useBoardFilterSort } from "@/lib/boards/use-board-filter-sort";

// The generic condition builder only offers real operators for these kinds
// (people + status are handled by the dedicated quick-filters above it).
const ADVANCED_KINDS = new Set([
  "text",
  "status",
  "numbers",
  "currency",
  "date",
]);

function optionsOf(col: CacheColumn): ColumnOption[] {
  const opts = (col.settings as { options?: ColumnOption[] } | null)?.options;
  return Array.isArray(opts) ? opts : [];
}

function memberLabel(m: HeaderMember): string {
  return m.fullName ?? m.email ?? "Unknown member";
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/** A small monochrome selectable row used in the filter/sort popovers. */
function OptionRow({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        "hover:bg-accent focus-visible:ring-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none",
        selected && "bg-accent",
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {selected ? <Check className="size-3.5" /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

function SortLabel({
  field,
  columns,
}: {
  field: SortField;
  columns: CacheColumn[];
}) {
  if (field.kind === "name") return <>Name</>;
  if (field.kind === "created") return <>Created</>;
  const col = columns.find((c) => c.id === field.columnId);
  return <>{col?.name ?? "Column"}</>;
}

/**
 * Board filter / sort / quick-search toolbar. All state lives in the URL (via
 * {@link useBoardFilterSort}) and is applied to the already-loaded board cache
 * in memory by the Table + Kanban views — 0 server round-trips per interaction
 * (AGENTS.md §invariants). Rendered inside {@link BoardHeader} for filterable
 * views only.
 */
export function BoardToolbar({
  columns,
  members,
  currentUserId,
}: {
  columns: CacheColumn[];
  members: HeaderMember[];
  currentUserId: string;
}) {
  const {
    state,
    facetCount,
    isActive,
    setSearch,
    setPeople,
    setStatus,
    setConditions,
    setSort,
    clearAll,
  } = useBoardFilterSort();
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  const peopleColumns = columns.filter((c) => c.kind === "people");
  const statusColumns = columns.filter((c) => c.kind === "status");

  // Status options across every status column, de-duplicated by option id.
  const statusOptions: ColumnOption[] = [];
  const seen = new Set<string>();
  for (const col of statusColumns) {
    for (const o of optionsOf(col)) {
      if (!seen.has(o.id)) {
        seen.add(o.id);
        statusOptions.push(o);
      }
    }
  }

  // Columns the generic builder can express conditions over.
  const advancedColumns = columns
    .filter((c) => ADVANCED_KINDS.has(c.kind))
    .map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      options: optionsOf(c).map((o) => ({
        id: o.id,
        label: o.label,
        color: o.color,
      })),
    }));

  // Sort targets: built-ins + every column (position order).
  const sortFields: { field: SortField; label: string }[] = [
    { field: { kind: "name" }, label: "Name" },
    { field: { kind: "created" }, label: "Created" },
    ...columns.map((c) => ({
      field: { kind: "column", columnId: c.id } as SortField,
      label: c.name,
    })),
  ];

  function fieldKey(f: SortField): string {
    return f.kind === "column" ? `col:${f.columnId}` : f.kind;
  }
  const activeSortKey = state.sort ? fieldKey(state.sort.field) : null;
  const dir = state.sort?.direction ?? "asc";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Quick search */}
      <InputGroup className="ease-keystone focus-within:border-border-bright h-7 w-52 rounded-full transition-colors">
        <InputGroupAddon>
          <Search className="size-3.5" />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search items"
          placeholder="Search…"
          value={state.q}
          onChange={(e) => setSearch(e.target.value)}
        />
        {state.q ? (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label="Clear search"
              onClick={() => setSearch("")}
            >
              <X />
            </InputGroupButton>
          </InputGroupAddon>
        ) : null}
      </InputGroup>

      {/* Filter */}
      <Popover open={filterOpen} onOpenChange={setFilterOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ease-keystone border-border hover:border-border-bright rounded-full border transition-colors"
            aria-label={
              facetCount > 0 ? `Filter (${facetCount} active)` : "Filter"
            }
          >
            <ListFilter className="size-3.5" /> Filter
            {facetCount > 0 ? (
              <span className="bg-primary text-primary-foreground ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[0.65rem] font-semibold tabular-nums">
                {facetCount}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="flex max-h-[70vh] w-80 flex-col gap-3 overflow-auto p-3"
        >
          {/* People quick-filter */}
          {peopleColumns.length > 0 ? (
            <section aria-label="Filter by person">
              <p className="text-muted-foreground mb-1 px-1 text-xs font-medium">
                Assigned to
              </p>
              <div className="flex flex-col">
                <OptionRow
                  selected={state.people.includes(currentUserId)}
                  onClick={() => setPeople(toggle(state.people, currentUserId))}
                >
                  My items
                </OptionRow>
                {members
                  .filter((m) => m.userId !== currentUserId)
                  .map((m) => (
                    <OptionRow
                      key={m.userId}
                      selected={state.people.includes(m.userId)}
                      onClick={() => setPeople(toggle(state.people, m.userId))}
                    >
                      {memberLabel(m)}
                    </OptionRow>
                  ))}
              </div>
            </section>
          ) : null}

          {peopleColumns.length > 0 && statusOptions.length > 0 ? (
            <Separator />
          ) : null}

          {/* Status quick-filter */}
          {statusOptions.length > 0 ? (
            <section aria-label="Filter by status">
              <p className="text-muted-foreground mb-1 px-1 text-xs font-medium">
                Status
              </p>
              <div className="flex flex-col">
                {statusOptions.map((o) => (
                  <OptionRow
                    key={o.id}
                    selected={state.status.includes(o.id)}
                    onClick={() => setStatus(toggle(state.status, o.id))}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: o.color }}
                      />
                      {o.label}
                    </span>
                  </OptionRow>
                ))}
              </div>
            </section>
          ) : null}

          {(peopleColumns.length > 0 || statusOptions.length > 0) &&
          advancedColumns.length > 0 ? (
            <Separator />
          ) : null}

          {/* Generic condition builder — reuses the dashboards ListFilter model */}
          <FilterBuilder
            columns={advancedColumns}
            value={state.conditions}
            onChange={setConditions}
          />
        </PopoverContent>
      </Popover>

      {/* Sort */}
      <Popover open={sortOpen} onOpenChange={setSortOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ease-keystone border-border hover:border-border-bright rounded-full border transition-colors"
            aria-label="Sort"
          >
            <ArrowDownUp className="size-3.5" />
            {state.sort ? (
              <span className="flex items-center gap-1">
                <SortLabel field={state.sort.field} columns={columns} />
                {dir === "asc" ? (
                  <ArrowUp className="size-3" />
                ) : (
                  <ArrowDown className="size-3" />
                )}
              </span>
            ) : (
              "Sort"
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          role="listbox"
          aria-label="Sort by"
          className="flex max-h-[60vh] w-56 flex-col gap-0.5 overflow-auto p-1.5"
        >
          {/* Direction toggle */}
          <div className="mb-1 flex items-center gap-1 px-1">
            <Button
              type="button"
              variant={dir === "asc" ? "secondary" : "ghost"}
              size="xs"
              className="flex-1"
              aria-pressed={dir === "asc"}
              onClick={() =>
                state.sort &&
                setSort({ field: state.sort.field, direction: "asc" })
              }
              disabled={!state.sort}
            >
              <ArrowUp className="size-3" /> Asc
            </Button>
            <Button
              type="button"
              variant={dir === "desc" ? "secondary" : "ghost"}
              size="xs"
              className="flex-1"
              aria-pressed={dir === "desc"}
              onClick={() =>
                state.sort &&
                setSort({ field: state.sort.field, direction: "desc" })
              }
              disabled={!state.sort}
            >
              <ArrowDown className="size-3" /> Desc
            </Button>
          </div>
          <Separator className="my-1" />
          <OptionRow selected={!state.sort} onClick={() => setSort(null)}>
            None (board order)
          </OptionRow>
          {sortFields.map(({ field, label }) => (
            <OptionRow
              key={fieldKey(field)}
              selected={activeSortKey === fieldKey(field)}
              onClick={() => setSort({ field, direction: dir })}
            >
              {label}
            </OptionRow>
          ))}
        </PopoverContent>
      </Popover>

      {isActive ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground ease-keystone border-border hover:border-border-bright rounded-full border transition-colors"
          onClick={clearAll}
        >
          <X className="size-3.5" /> Clear all
        </Button>
      ) : null}
    </div>
  );
}
