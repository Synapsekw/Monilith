import { describe, it, expect } from "vitest";
import {
  prependAttachment,
  removeAttachment,
  type AttachmentsCache,
} from "@/lib/collaboration/attachments-cache";
import type { Tables } from "@/types/database.types";

function a(id: string): Tables<"attachments"> {
  return {
    id,
    org_id: "o",
    board_id: "b",
    item_id: "i",
    update_id: null,
    uploaded_by: "u",
    storage_path: `o/b/i/${id}-x.png`,
    file_name: "x.png",
    mime_type: "image/png",
    size_bytes: 10,
    created_at: "2026-06-17T00:00:00Z",
  } as Tables<"attachments">;
}

describe("attachments cache", () => {
  it("prepends + de-dupes by id", () => {
    let c: AttachmentsCache = { attachments: [a("a")] };
    c = prependAttachment(c, a("b"));
    expect(c.attachments.map((x) => x.id)).toEqual(["b", "a"]);
    c = prependAttachment(c, a("b"));
    expect(c.attachments).toHaveLength(2);
  });
  it("removes by id", () => {
    const c = removeAttachment({ attachments: [a("a"), a("b")] }, "a");
    expect(c.attachments.map((x) => x.id)).toEqual(["b"]);
  });
});
