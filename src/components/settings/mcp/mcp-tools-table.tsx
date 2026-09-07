import { StatusPill } from "@/components/ui/status-pill";
import { ALL_TOOL_DESCRIPTORS } from "@/lib/mcp/tools/catalog";

/**
 * The tools a connected client can call.
 *
 * `name` and `access` are DERIVED from `ALL_TOOL_DESCRIPTORS`
 * (`src/lib/mcp/tools/catalog.ts`), the same list `registerTools` iterates to
 * register tools on the MCP server — so a registered tool can never be
 * missing from this table, and `access` (from the descriptor's `capability`)
 * can never mislabel a write as a read.
 *
 * `what` is NOT derived — it is hand-written prose per tool, and the thing
 * that keeps it mandatory is the RUNTIME TEST in `mcp-tools-table.test.tsx`
 * ("carries consent prose for every registered tool"), not the type below.
 *
 * `TOOL_PROSE` is typed `Record<ToolName, string>` where `ToolName =
 * (typeof ALL_TOOL_DESCRIPTORS)[number]["name"]`. This LOOKS like it forces
 * every tool to have an entry, but it does not: `ToolDescriptor.name` is
 * declared as plain `string`, so `ToolName` resolves to `string`, and
 * `Record<string, string>` is not checked for completeness — TypeScript
 * happily compiles a `TOOL_PROSE` object literal missing an entry for a 25th
 * tool. (Verified empirically: assigning a bogus string to `ToolName`
 * produces no `tsc --noEmit` error.) The annotation and the removed `?? ""`
 * fallback below are kept anyway because they still express intent, and
 * because without the fallback a missing entry surfaces as `undefined` — for
 * the runtime test to catch — rather than being silently papered over with an
 * empty description. Do not delete that test on the strength of this type.
 */
type ToolName = (typeof ALL_TOOL_DESCRIPTORS)[number]["name"];
export const TOOL_PROSE: Record<ToolName, string> = {
  list_boards: "List the boards you can see.",
  get_board: "Read a board's metadata, columns, and groups.",
  list_items: "Read a board's items and their cell values.",
  search_items: "Find items by name within a board.",
  get_item: "Read one item's fields and cell values.",
  create_item: "Add a new item to a group, optionally setting field values.",
  update_item: "Rename an item and/or change its field values.",
  create_attachment_upload:
    "Start a file upload for an item — returns a 2-hour signed URL that can place a file in your storage. Nothing appears on the item until attach_file is called.",
  attach_file:
    "Attach a file to an item, or into a Files column's cell. Cannot replace or remove an existing attachment.",
  list_organizations: "List the organizations you belong to.",
  get_my_work: "Read everything assigned to you, grouped by due date.",
  list_time_allocations: "Read the time you have logged between two dates.",
  get_time_summary:
    "Read totals of your logged time, by item, category, or day.",
  log_time_allocation:
    "Set your logged time for a day and item or category — replaces any existing value for that day/target; 0 clears it.",
  list_goals: "Read your organization's goals and their hierarchy.",
  get_goal: "Read one goal's detail and a summary of its children.",
  list_portfolios: "List the portfolios you can see.",
  get_portfolio: "Read a portfolio's board rollup.",
  list_dashboards: "List the dashboards you can see.",
  get_dashboard: "Read a dashboard's widget list (not their data).",
  get_widget_data: "Read one widget's resolved data.",
  get_workload: "Read your team's planned load and capacity.",
  list_reports:
    "List the saved reports that include a board — its own, plus any multi-board or portfolio roll-up covering it.",
  get_report:
    "Read a report's structure and which boards it spans (not the underlying data).",
  describe_schema:
    "Read-only lookup of your settings shape — column kinds, view types, widget kinds, and report shapes — with a worked example for each. Reads no data.",
  manage_board:
    "Create, rename, duplicate, archive, or restore a board. No delete: archive moves it to Trash and can be reversed with restore.",
  manage_group:
    "Create (up to 50 at once), rename, reorder, recolor, archive, or restore a board group. No delete: archive moves it to Trash and can be reversed with restore.",
  manage_column:
    "Create (up to 50 at once), rename, configure, reorder, resize, or delete a column, and remove a single status/dropdown option. Deleting a column also deletes its cell values and cannot be undone; removing an option clears it from every cell that used it.",
  manage_item:
    "Archive, restore, move, or reorder an item, and add a subitem. No delete: archive moves it to Trash and can be reversed with restore. Moving an item carries its subitems with it.",
  manage_view:
    "Create, update, or delete a board view (table, kanban, calendar, timeline). Deleting a view cannot be undone.",
  manage_dashboard:
    "Create, rename, duplicate, or delete a dashboard, and save its widget layout. Deleting a dashboard cannot be undone.",
  manage_widget:
    "Create, update, or delete a dashboard widget. Deleting a widget cannot be undone.",
  manage_goal:
    "Create, update, or delete a goal, and set which boards or columns it links to. Deleting a goal cannot be undone.",
  manage_portfolio:
    "Create a portfolio, add or remove a board from it, and update a board's placement within it.",
  manage_report:
    "Create, save, or delete a report, and change which boards or portfolio it covers. Deleting a report cannot be undone.",
};

export const MCP_TOOLS_TABLE_ROWS = ALL_TOOL_DESCRIPTORS.map((d) => ({
  name: d.name,
  // A dispatch tool's `capability` is a Record. `=== null` would be false for
  // it and the ternary would read "write" by luck rather than by rule — and
  // would read "read" by luck if the field were ever `{}`. Be explicit.
  access:
    d.capability === null ||
    (typeof d.capability === "object" &&
      Object.values(d.capability).every((c) => c === null))
      ? ("read" as const)
      : ("write" as const),
  what: TOOL_PROSE[d.name],
}));

export function McpToolsTable() {
  return (
    <div className="space-y-3 py-4">
      <ul className="border-border divide-border divide-y rounded-lg border">
        {MCP_TOOLS_TABLE_ROWS.map((tool) => (
          <li
            key={tool.name}
            className="flex items-center justify-between gap-4 px-3 py-2.5"
          >
            <div className="min-w-0">
              <code className="text-foreground font-mono text-xs">
                {tool.name}
              </code>
              <p className="text-muted-foreground mt-0.5 text-sm">
                {tool.what}
              </p>
            </div>
            <StatusPill
              color={tool.access === "write" ? "blue" : "gray"}
              variant="soft"
            >
              {tool.access === "write" ? "Write" : "Read"}
            </StatusPill>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-sm">
        Setting a day&rsquo;s logged time to 0 seconds clears it. Columns
        (including a single status or dropdown option), views, widgets, goals,
        reports, and dashboards can also be deleted outright, and that cannot be
        undone. Boards, groups, and items are different: a connected client can
        only archive them to Trash and restore them — never delete them
        permanently. Every call runs as you and is subject to the same
        permissions you have in the app.
      </p>
    </div>
  );
}
