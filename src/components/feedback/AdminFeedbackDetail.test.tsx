import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdminFeedbackDetail } from "./AdminFeedbackDetail";

const row = {
  id: "f1",
  kind: "bug",
  title: "Export crashes",
  body: "Boom",
  status: "new",
  admin_response: null,
} as never;

describe("AdminFeedbackDetail", () => {
  it("submits the selected status + response via the action", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, data: undefined });
    render(<AdminFeedbackDetail row={row} save={save} />);
    fireEvent.change(screen.getByPlaceholderText(/response/i), {
      target: { value: "Fixed today" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ id: "f1", adminResponse: "Fixed today" }),
      ),
    );
  });
});
