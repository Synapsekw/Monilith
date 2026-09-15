import { describe, expect, it } from "vitest";
import { dashboardRedirectTarget } from "./redirect";

describe("dashboardRedirectTarget", () => {
  it("sends a folded-in dashboard to its folder's Overview widgets anchor", () => {
    expect(dashboardRedirectTarget({ folder_id: "f1" }, true)).toBe(
      "/folders/f1?tab=overview#widgets",
    );
  });
  it("stays on the legacy canvas when unfiled or when the folder is gone/hidden", () => {
    expect(dashboardRedirectTarget({ folder_id: null }, false)).toBeNull();
    expect(dashboardRedirectTarget({ folder_id: "f1" }, false)).toBeNull();
  });
});
