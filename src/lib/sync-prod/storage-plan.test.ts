import { describe, it, expect } from "vitest";
import { planStorageSync } from "./storage-plan";

describe("planStorageSync", () => {
  it("creates dev-only buckets, copies all dev objects, deletes prod-only objects", () => {
    const plan = planStorageSync(
      [
        { id: "attachments", public: false },
        { id: "avatars", public: true },
      ],
      [{ id: "attachments", public: false }], // prod missing "avatars"
      [
        { bucket: "attachments", name: "a.png" },
        { bucket: "avatars", name: "me.png" },
      ],
      [
        { bucket: "attachments", name: "a.png" },
        { bucket: "attachments", name: "stale.png" },
      ],
    );
    expect(plan.bucketsToCreate).toEqual([{ id: "avatars", public: true }]);
    expect(plan.objectsToCopy).toEqual([
      { bucket: "attachments", name: "a.png" },
      { bucket: "avatars", name: "me.png" },
    ]);
    expect(plan.objectsToDelete).toEqual([
      { bucket: "attachments", name: "stale.png" },
    ]);
  });

  it("is a no-op when dev and prod already match", () => {
    const objs = [{ bucket: "attachments", name: "a.png" }];
    const buckets = [{ id: "attachments", public: false }];
    const plan = planStorageSync(buckets, buckets, objs, objs);
    expect(plan).toEqual({
      bucketsToCreate: [],
      objectsToCopy: objs,
      objectsToDelete: [],
    });
  });
});
