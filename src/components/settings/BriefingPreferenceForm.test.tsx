import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const setEmailBriefingOptOut = vi.fn(async (_input: unknown) => ({
  ok: true,
  data: null,
}));
vi.mock("@/lib/settings/digest-actions", () => ({
  setEmailBriefingOptOut: (input: unknown) => setEmailBriefingOptOut(input),
}));

import { BriefingPreferenceForm } from "@/components/settings/BriefingPreferenceForm";

const NAME = /email me my daily agent briefing/i;

describe("BriefingPreferenceForm", () => {
  it("renders on when subscribed and calls the action on toggle", async () => {
    render(<BriefingPreferenceForm initialOptOut={false} />);
    const toggle = screen.getByRole("switch", { name: NAME });
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(setEmailBriefingOptOut).toHaveBeenCalledWith({ optOut: true }),
    );
    expect(toggle).not.toBeChecked();
  });

  it("renders off when opted out", () => {
    render(<BriefingPreferenceForm initialOptOut={true} />);
    expect(screen.getByRole("switch", { name: NAME })).not.toBeChecked();
  });

  it("reverts when the action fails", async () => {
    setEmailBriefingOptOut.mockResolvedValueOnce({
      ok: false,
      error: "nope",
    } as never);
    render(<BriefingPreferenceForm initialOptOut={false} />);
    const toggle = screen.getByRole("switch", { name: NAME });

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
  });
});
