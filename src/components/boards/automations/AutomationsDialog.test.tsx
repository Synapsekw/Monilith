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
vi.mock("@/lib/boards/automation-actions", () => ({
  getAutomations: (...a: unknown[]) => getAutomations(...a),
  createAutomation: (...a: unknown[]) => createAutomation(...a),
  updateAutomation: (...a: unknown[]) => updateAutomation(...a),
  deleteAutomation: (...a: unknown[]) => deleteAutomation(...a),
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

    // Default: no automations, successful mutations.
    getAutomations.mockResolvedValue([]);
    createAutomation.mockResolvedValue({ ok: true, data: { id: "auto-1" } });
    updateAutomation.mockResolvedValue({ ok: true });
    deleteAutomation.mockResolvedValue({ ok: true });
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
