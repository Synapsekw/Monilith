import { describe, it, expect, vi, beforeEach } from "vitest";

const remove = vi.fn();
const storageFrom = vi.fn(() => ({ remove }));
const createService = vi.fn(() => ({ storage: { from: storageFrom } }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createService(),
}));

import { removeAttachmentObjects } from "./attachment-cleanup";

beforeEach(() => {
  remove.mockReset();
  remove.mockResolvedValue({ error: null });
  storageFrom.mockClear();
  createService.mockClear();
});

describe("removeAttachmentObjects", () => {
  it("is a no-op for an empty list (no service client constructed)", async () => {
    await removeAttachmentObjects([]);
    expect(createService).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("removes every path from the attachments bucket in one batch", async () => {
    await removeAttachmentObjects(["a/b/c/1.png", "a/b/c/2.png"]);
    expect(storageFrom).toHaveBeenCalledWith("attachments");
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(["a/b/c/1.png", "a/b/c/2.png"]);
  });

  it("chunks more than 100 paths into batches of 100", async () => {
    const paths = Array.from({ length: 250 }, (_, i) => `a/b/c/${i}.png`);
    await removeAttachmentObjects(paths);
    expect(remove).toHaveBeenCalledTimes(3);
    expect(remove.mock.calls[0][0]).toHaveLength(100);
    expect(remove.mock.calls[1][0]).toHaveLength(100);
    expect(remove.mock.calls[2][0]).toHaveLength(50);
  });

  it("does not throw when a batch removal errors", async () => {
    remove.mockResolvedValue({ error: { message: "boom" } });
    await expect(
      removeAttachmentObjects(["a/b/c/1.png"]),
    ).resolves.toBeUndefined();
  });
});
