import { describe, expect, it } from "vitest";
import {
  buildAvatarPath,
  extForMime,
  pathFromPublicUrl,
} from "@/lib/profile/avatar-path";

const UID = "11111111-1111-1111-1111-111111111111";

describe("avatar-path", () => {
  it("builds a key under the user's own prefix with a uuid + ext", () => {
    const p = buildAvatarPath(UID, "image/webp");
    expect(p).toMatch(new RegExp(`^${UID}/[0-9a-f-]{36}\\.webp$`));
  });

  it("maps mime types to extensions", () => {
    expect(extForMime("image/png")).toBe("png");
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(extForMime("image/webp")).toBe("webp");
  });

  it("throws on an unsupported mime type", () => {
    expect(() => extForMime("image/gif")).toThrow();
  });

  it("round-trips the object key out of a public URL", () => {
    const url = `https://ref.supabase.co/storage/v1/object/public/avatars/${UID}/abc.webp`;
    expect(pathFromPublicUrl(url)).toBe(`${UID}/abc.webp`);
  });

  it("returns null for a URL that is not an avatars public URL", () => {
    expect(pathFromPublicUrl("https://example.com/x.png")).toBeNull();
    expect(pathFromPublicUrl(null)).toBeNull();
  });
});
