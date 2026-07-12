import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Mock the server-action module so no Supabase calls happen.
const getAutomations = vi.fn();
const createAutomation = vi.fn();
const updateAutomation = vi.fn();
const deleteAutomation = vi.fn();
const getBoardAdminStatus = vi.fn();
vi.mock("@/lib/boards/automation-actions", () => ({
  getAutomations: (...a: unknown[]) => getAutomations(...a),
  createAutomation: (...a: unknown[]) => createAutomation(...a),
  updateAutomation: (...a: unknown[]) => updateAutomation(...a),
  deleteAutomation: (...a: unknown[]) => deleteAutomation(...a),
  getBoardAdminStatus: (...a: unknown[]) => getBoardAdminStatus(...a),
}));

const generateAutomationDraft = vi.fn();
vi.mock("@/lib/ai/automation-gen-actions", () => ({
  generateAutomationDraft: (...a: unknown[]) => generateAutomationDraft(...a),
}));

import { AutomationsDialog } from "./AutomationsDialog";
import type { CacheColumn } from "@/lib/boards/cache";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function col(over: Partial<CacheColumn>): CacheColumn {
  return {
    id: "c",
    board_id: "b1",
    org_id: "o1",
    name: "Col",
    kind: "text",
    position: 0,
    width: null,
    settings: {},
    created_at: "",
    updated_at: "",
    ...over,
  } as CacheColumn;
}

const statusCol = col({
  id: "c-status",
  name: "Status",
  kind: "status",
  settings: {
    options: [
      { id: "opt-done", label: "Done", color: "green" },
      { id: "opt-stuck", label: "Stuck", color: "red" },
    ],
  } as unknown as CacheColumn["settings"],
});

const peopleCol = col({ id: "c-people", name: "Owner", kind: "people" });

const columns = [statusCol, peopleCol];
const members = [
  { userId: "u1", fullName: "Ada Lovelace", email: "ada@x.com" },
];

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderDialog() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const onOpenChange = vi.fn();
  render(
    <AutomationsDialog
      open
      boardId="board-1"
      columns={columns}
      members={members}
      onOpenChange={onOpenChange}
    />,
    { wrapper: Wrapper },
  );
  return { onOpenChange };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AutomationsDialog", () => {
  beforeEach(() => {
    getAutomations.mockReset();
    createAutomation.mockReset();
    updateAutomation.mockReset();
    deleteAutomation.mockReset();
    getBoardAdminStatus.mockReset();
    generateAutomationDraft.mockReset();

    // Default: no automations, successful mutations, non-admin.
    getAutomations.mockResolvedValue([]);
    createAutomation.mockResolvedValue({ ok: true, data: { id: "auto-1" } });
    updateAutomation.mockResolvedValue({ ok: true });
    deleteAutomation.mockResolvedValue({ ok: true });
    getBoardAdminStatus.mockResolvedValue(false);
  });

  it("starts in list mode with a 'New automation' button", async () => {
    renderDialog();
    expect(
      await screen.findByRole("button", { name: /new automation/i }),
    ).toBeInTheDocument();
  });

  it("switches to build mode when 'New automation' is clicked", async () => {
    renderDialog();
    const newBtn = await screen.findByRole("button", {
      name: /new automation/i,
    });
    await userEvent.click(newBtn);

    // Build mode shows a Trigger type select.
    expect(screen.getByLabelText("Trigger type")).toBeInTheDocument();
  });

  it("shows recipe quick-start buttons in build mode when no draft is set", async () => {
    renderDialog();
    const newBtn = await screen.findByRole("button", {
      name: /new automation/i,
    });
    await userEvent.click(newBtn);

    // Both columns are present: people → "Notify on assignment" appears.
    expect(
      screen.getByRole("button", { name: /notify on assignment/i }),
    ).toBeInTheDocument();
    // Status column present → "Set a column when an item is created" appears.
    expect(
      screen.getByRole("button", {
        name: /set a column when an item is created/i,
      }),
    ).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // REGRESSION: clicking a recipe from within build mode must populate the
  // builder (the key bug this fix addresses).
  // -----------------------------------------------------------------------
  describe("recipe quick-starts populate the builder when clicked from within build mode", () => {
    it("'Set a column when an item is created' sets trigger to item_created", async () => {
      renderDialog();

      // Enter build mode (blank builder, recipe buttons visible).
      const newBtn = await screen.findByRole("button", {
        name: /new automation/i,
      });
      await userEvent.click(newBtn);

      // Confirm builder is mounted with default trigger (status_changed).
      expect(
        (screen.getByLabelText("Trigger type") as HTMLSelectElement).value,
      ).toBe("status_changed");

      // Click the recipe button — this should remount the builder seeded with
      // an item_created trigger.
      await userEvent.click(
        screen.getByRole("button", {
          name: /set a column when an item is created/i,
        }),
      );

      // After remount the Trigger type select must reflect item_created.
      await waitFor(() => {
        expect(
          (screen.getByLabelText("Trigger type") as HTMLSelectElement).value,
        ).toBe("item_created");
      });

      // The recipe also pre-seeds a set_option action, so the action row should
      // be present (the "Set column" aria-label comes from SetOptionRow).
      expect(screen.getByLabelText("Set column")).toBeInTheDocument();
    });

    it("'Notify on assignment' sets trigger to person_assigned", async () => {
      renderDialog();

      // Enter build mode.
      const newBtn = await screen.findByRole("button", {
        name: /new automation/i,
      });
      await userEvent.click(newBtn);

      // Click the "Notify on assignment" recipe.
      await userEvent.click(
        screen.getByRole("button", { name: /notify on assignment/i }),
      );

      // Builder should now show person_assigned trigger.
      await waitFor(() => {
        expect(
          (screen.getByLabelText("Trigger type") as HTMLSelectElement).value,
        ).toBe("person_assigned");
      });

      // And a notify action row (Recipient type select comes from NotifyRow).
      expect(screen.getByLabelText("Recipient type")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // date_reached trigger: summarize() produces the right text.
  // -----------------------------------------------------------------------
  describe("summarize() for date_reached trigger", () => {
    const dateCol = col({ id: "c-date", name: "Due Date", kind: "date" });
    const allColumns = [...columns, dateCol];

    // We render the dialog with a pre-loaded automation so summarize() is exercised.
    function renderWithRule(offsetDays: number) {
      const rule = {
        id: "auto-dr",
        board_id: "board-1",
        org_id: "o1",
        name: null,
        enabled: true,
        trigger: { type: "date_reached", columnId: "c-date", offsetDays },
        actions: [
          {
            type: "notify",
            recipient: { kind: "owner", peopleColumnId: "c-people" },
          },
        ],
        condition: null,
        created_at: "",
        updated_at: "",
      };
      getAutomations.mockResolvedValue([rule]);

      const qc = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });
      const Wrapper = ({
        children,
      }: {
        children: import("react").ReactNode;
      }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
      render(
        <AutomationsDialog
          open
          boardId="board-1"
          columns={allColumns}
          members={members}
          onOpenChange={vi.fn()}
        />,
        { wrapper: Wrapper },
      );
    }

    it("offset 0 → 'is reached'", async () => {
      renderWithRule(0);
      expect(await screen.findByText(/is reached/i)).toBeInTheDocument();
    });

    it("offset -3 → 'in 3 days'", async () => {
      renderWithRule(-3);
      expect(await screen.findByText(/in 3 days/i)).toBeInTheDocument();
    });

    it("offset +2 → '2 days overdue'", async () => {
      renderWithRule(2);
      expect(await screen.findByText(/2 days overdue/i)).toBeInTheDocument();
    });
  });

  describe("summarize() for move_to_group action", () => {
    function renderWithMoveRule() {
      const rule = {
        id: "auto-mg",
        board_id: "board-1",
        org_id: "o1",
        name: null,
        enabled: true,
        trigger: {
          type: "status_changed",
          columnId: "c-status",
          toOptionId: "opt-done",
        },
        actions: [{ type: "move_to_group", groupId: "g-done" }],
        condition: null,
        created_at: "",
        updated_at: "",
      };
      getAutomations.mockResolvedValue([rule]);

      const qc = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });
      const Wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      );
      render(
        <AutomationsDialog
          open
          boardId="board-1"
          columns={columns}
          members={members}
          groups={[{ id: "g-done", name: "Done" }]}
          onOpenChange={vi.fn()}
        />,
        { wrapper: Wrapper },
      );
    }

    it("renders 'move to <GroupName>' for a move_to_group action", async () => {
      renderWithMoveRule();
      expect(await screen.findByText(/move to Done/i)).toBeInTheDocument();
    });
  });

  it("passes canWebhook=true to the builder for an admin", async () => {
    getBoardAdminStatus.mockResolvedValue(true);
    renderDialog();
    await userEvent.click(
      await screen.findByRole("button", { name: /new automation/i }),
    );
    // Both the recipe button ("Call a webhook on status change") AND the
    // builder's own action button ("Call a webhook") must be present, proving
    // that canWebhook=true reached <AutomationBuilder>.
    const webhookBtns = await screen.findAllByRole("button", {
      name: /call a webhook/i,
    });
    expect(webhookBtns.length).toBeGreaterThanOrEqual(2);
  });

  it("hides the webhook button for a non-admin", async () => {
    getBoardAdminStatus.mockResolvedValue(false);
    renderDialog();
    await userEvent.click(
      await screen.findByRole("button", { name: /new automation/i }),
    );
    // Neither the recipe button nor the builder's action button should render
    // when canWebhook=false (non-admin).
    expect(
      screen.queryAllByRole("button", { name: /call a webhook/i }),
    ).toHaveLength(0);
  });

  it("Cancel from build mode returns to list mode", async () => {
    renderDialog();
    const newBtn = await screen.findByRole("button", {
      name: /new automation/i,
    });
    await userEvent.click(newBtn);

    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    // Back to list — New automation button visible again.
    expect(
      screen.getByRole("button", { name: /new automation/i }),
    ).toBeInTheDocument();
  });
});

describe("percent-sync recipes + summarize", () => {
  const percentCol = col({
    id: "c-percent",
    name: "Progress",
    kind: "percent",
  });

  function renderWith(cols: CacheColumn[], rules: unknown[] = []) {
    getAutomations.mockResolvedValue(rules);
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    render(
      <AutomationsDialog
        open
        boardId="board-1"
        columns={cols}
        members={members}
        onOpenChange={vi.fn()}
      />,
      { wrapper: Wrapper },
    );
  }

  it("shows both percent-sync recipe buttons when status AND percent columns exist", async () => {
    renderWith([...columns, percentCol]);
    await userEvent.click(
      await screen.findByRole("button", { name: /new automation/i }),
    );
    expect(
      screen.getByRole("button", { name: /completed sets 100%/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /100% sets completed/i }),
    ).toBeInTheDocument();
  });

  it("hides the percent-sync recipe buttons without a percent column", async () => {
    renderWith(columns);
    await userEvent.click(
      await screen.findByRole("button", { name: /new automation/i }),
    );
    expect(
      screen.queryByRole("button", { name: /completed sets 100%/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /100% sets completed/i }),
    ).not.toBeInTheDocument();
  });

  it("'Completed sets 100%' seeds the builder with the done option preselected", async () => {
    renderWith([...columns, percentCol]);
    await userEvent.click(
      await screen.findByRole("button", { name: /new automation/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /completed sets 100%/i }),
    );
    await waitFor(() => {
      expect(
        (screen.getByLabelText("Trigger type") as HTMLSelectElement).value,
      ).toBe("status_changed");
    });
    // The /done|complete/i-labeled option is preselected as "changes to".
    expect(
      (screen.getByLabelText("Trigger value") as HTMLSelectElement).value,
    ).toBe("opt-done");
    // And a set_percent action row is seeded.
    expect(screen.getByLabelText("Set percent column")).toBeInTheDocument();
  });

  it("'100% sets Completed' seeds a percent_reached trigger", async () => {
    renderWith([...columns, percentCol]);
    await userEvent.click(
      await screen.findByRole("button", { name: /new automation/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /100% sets completed/i }),
    );
    await waitFor(() => {
      expect(
        (screen.getByLabelText("Trigger type") as HTMLSelectElement).value,
      ).toBe("percent_reached");
    });
    expect(screen.getByLabelText("Set column")).toBeInTheDocument();
  });

  it("summarize renders percent_reached triggers and set_percent actions", async () => {
    renderWith(
      [...columns, percentCol],
      [
        {
          id: "auto-ps",
          board_id: "board-1",
          org_id: "o1",
          name: null,
          enabled: true,
          trigger: {
            type: "percent_reached",
            columnId: "c-percent",
            percent: 100,
          },
          actions: [
            { type: "set_option", columnId: "c-status", optionId: "opt-done" },
          ],
          condition: null,
          created_at: "",
          updated_at: "",
        },
        {
          id: "auto-sp",
          board_id: "board-1",
          org_id: "o1",
          name: null,
          enabled: true,
          trigger: {
            type: "status_changed",
            columnId: "c-status",
            toOptionId: "opt-done",
          },
          actions: [
            { type: "set_percent", columnId: "c-percent", percent: 100 },
          ],
          condition: null,
          created_at: "",
          updated_at: "",
        },
      ],
    );
    expect(
      await screen.findByText(/When Progress reaches 100%/i),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/set Progress to 100%/i),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// F11: Describe-an-automation (NL → draft → seeds the builder; human Saves).
// ---------------------------------------------------------------------------
describe("describe-an-automation (AI)", () => {
  beforeEach(() => {
    getAutomations.mockReset().mockResolvedValue([]);
    createAutomation
      .mockReset()
      .mockResolvedValue({ ok: true, data: { id: "auto-1" } });
    updateAutomation.mockReset().mockResolvedValue({ ok: true });
    deleteAutomation.mockReset().mockResolvedValue({ ok: true });
    getBoardAdminStatus.mockReset().mockResolvedValue(false);
    generateAutomationDraft.mockReset();
  });

  async function enterBuild() {
    renderDialog();
    await userEvent.click(
      await screen.findByRole("button", { name: /new automation/i }),
    );
  }

  it("renders a describe input + Generate button in build mode", async () => {
    await enterBuild();
    expect(screen.getByLabelText("Describe an automation")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^generate$/i }),
    ).toBeInTheDocument();
  });

  it("seeds the builder and surfaces warnings on a successful generate", async () => {
    generateAutomationDraft.mockResolvedValue({
      ok: true,
      data: {
        draft: {
          trigger: { type: "item_created" },
          actions: [
            { type: "set_option", columnId: "c-status", optionId: "opt-done" },
          ],
          condition: null,
        },
        warnings: ["Dropped a webhook action — the AI can't create webhooks."],
      },
    });

    await enterBuild();
    await userEvent.type(
      screen.getByLabelText("Describe an automation"),
      "when an item is created set it to done",
    );
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }));

    // Builder is seeded with the generated trigger/action.
    await waitFor(() => {
      expect(
        (screen.getByLabelText("Trigger type") as HTMLSelectElement).value,
      ).toBe("item_created");
    });
    expect(screen.getByLabelText("Set column")).toBeInTheDocument();
    // Warnings render for the human to see what was adjusted.
    expect(screen.getByText(/can't create webhooks/i)).toBeInTheDocument();
    // The action was called with the board id + prompt (no persistence yet).
    expect(generateAutomationDraft).toHaveBeenCalledWith({
      boardId: "board-1",
      prompt: "when an item is created set it to done",
    });
    expect(createAutomation).not.toHaveBeenCalled();
  });

  it("still routes the builder's Save through createAutomation (unchanged write path)", async () => {
    generateAutomationDraft.mockResolvedValue({
      ok: true,
      data: {
        draft: {
          trigger: { type: "item_created" },
          actions: [
            { type: "set_option", columnId: "c-status", optionId: "opt-done" },
          ],
          condition: null,
        },
        warnings: [],
      },
    });

    await enterBuild();
    await userEvent.type(
      screen.getByLabelText("Describe an automation"),
      "set new items to done",
    );
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }));

    const saveBtn = await screen.findByRole("button", { name: /^save$/i });
    await userEvent.click(saveBtn);

    await waitFor(() => {
      expect(createAutomation).toHaveBeenCalledOnce();
    });
    expect(createAutomation.mock.calls[0][0]).toMatchObject({
      boardId: "board-1",
      trigger: { type: "item_created" },
      actions: [
        { type: "set_option", columnId: "c-status", optionId: "opt-done" },
      ],
    });
  });

  it("shows an inline alert when generate fails", async () => {
    generateAutomationDraft.mockResolvedValue({
      ok: false,
      error: "Couldn't turn that into an automation — try rephrasing.",
    });

    await enterBuild();
    await userEvent.type(
      screen.getByLabelText("Describe an automation"),
      "do something impossible",
    );
    await userEvent.click(screen.getByRole("button", { name: /^generate$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /try rephrasing/i,
    );
  });
});
