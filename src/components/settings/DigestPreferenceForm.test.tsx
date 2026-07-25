import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const setEmailDigestOptOut = vi.fn(async (_input: unknown) => ({
  ok: true,
  data: null,
}));
vi.mock("@/lib/settings/digest-actions", () => ({
  setEmailDigestOptOut: (input: unknown) => setEmailDigestOptOut(input),
}));

import { DigestPreferenceForm } from "@/components/settings/DigestPreferenceForm";

const NAME = /email me the weekly plan health digest/i;

describe("DigestPreferenceForm", () => {
  it("renders on when subscribed and calls the action on toggle", async () => {
    render(<DigestPreferenceForm initialOptOut={false} />);
    const toggle = screen.getByRole("switch", { name: NAME });
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);
    await waitFor(() =>
      expect(setEmailDigestOptOut).toHaveBeenCalledWith({ optOut: true }),
    );
    expect(toggle).not.toBeChecked();
  });

  it("renders off when opted out", () => {
    render(<DigestPreferenceForm initialOptOut={true} />);
    expect(screen.getByRole("switch", { name: NAME })).not.toBeChecked();
  });

  it("reverts when the action fails", async () => {
    setEmailDigestOptOut.mockResolvedValueOnce({
      ok: false,
      error: "nope",
    } as never);
    render(<DigestPreferenceForm initialOptOut={false} />);
    const toggle = screen.getByRole("switch", { name: NAME });

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
  });
});
