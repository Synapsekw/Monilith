import { describe, expect, it } from "vitest";

import {
  addBoardSchema,
  createPortfolioSchema,
  doneOptionIdsSchema,
  removePlacementSchema,
  updateMappingSchema,
  updatePlacementSchema,
} from "./portfolios";

// Zod 4's `z.string().uuid()` enforces the RFC variant: the version nibble must
// be 1-8 and the variant nibble one of 8/9/a/b. "11111111-1111-1111-..." fails,
// so fixtures use valid RFC UUIDs (version 4, variant 8) like the sibling specs.
const PORTFOLIO_ID = "11111111-1111-4111-8111-111111111111";
const BOARD_ID = "22222222-2222-4222-8222-222222222222";
const COLUMN_ID = "33333333-3333-4333-8333-333333333333";
const PLACEMENT_ID = "44444444-4444-4444-8444-444444444444";

describe("portfolios validations", () => {
  it("accepts a valid create input", () => {
    expect(
      createPortfolioSchema.safeParse({ name: "Q3 Initiatives" }).success,
    ).toBe(true);
  });
  it("rejects an empty name", () => {
    expect(createPortfolioSchema.safeParse({ name: "  " }).success).toBe(false);
  });
  it("accepts a valid add-board input with a mapping", () => {
    const ok = addBoardSchema.safeParse({
      portfolioId: PORTFOLIO_ID,
      boardId: BOARD_ID,
      doneColumnId: COLUMN_ID,
      doneOptionIds: ["opt-done"],
    });
    expect(ok.success).toBe(true);
  });
  it("allows a null done column (board with no status column)", () => {
    const ok = addBoardSchema.safeParse({
      portfolioId: PORTFOLIO_ID,
      boardId: BOARD_ID,
      doneColumnId: null,
      doneOptionIds: [],
    });
    expect(ok.success).toBe(true);
  });
  it("validates manual placement fields and rejects a bad priority", () => {
    expect(
      updatePlacementSchema.safeParse({
        placementId: PLACEMENT_ID,
        portfolioId: PORTFOLIO_ID,
        priority: "urgent",
      }).success,
    ).toBe(false);
    expect(
      updatePlacementSchema.safeParse({
        placementId: PLACEMENT_ID,
        portfolioId: PORTFOLIO_ID,
        priority: "high",
        budget: 50000,
        healthOverride: "at_risk",
        statusNote: "Vendor slipped a week",
      }).success,
    ).toBe(true);
  });
  it("caps done option ids", () => {
    expect(doneOptionIdsSchema.safeParse(Array(60).fill("x")).success).toBe(
      false,
    );
  });
  it("accepts a valid mapping update", () => {
    expect(
      updateMappingSchema.safeParse({
        placementId: PLACEMENT_ID,
        portfolioId: PORTFOLIO_ID,
        doneColumnId: COLUMN_ID,
        doneOptionIds: ["a", "b"],
      }).success,
    ).toBe(true);
  });

  // Security: portfolioId flows into revalidatePath() and must be a parsed uuid,
  // not raw client input.
  it("requires portfolioId on removePlacementSchema and rejects non-uuid", () => {
    expect(
      removePlacementSchema.safeParse({ placementId: PLACEMENT_ID }).success,
    ).toBe(false); // missing portfolioId
    expect(
      removePlacementSchema.safeParse({
        placementId: PLACEMENT_ID,
        portfolioId: "/evil",
      }).success,
    ).toBe(false); // non-uuid
    expect(
      removePlacementSchema.safeParse({
        placementId: PLACEMENT_ID,
        portfolioId: PORTFOLIO_ID,
      }).success,
    ).toBe(true);
  });
  it("rejects a non-uuid portfolioId on updatePlacementSchema", () => {
    expect(
      updatePlacementSchema.safeParse({
        placementId: PLACEMENT_ID,
        portfolioId: "not-a-uuid",
      }).success,
    ).toBe(false);
  });
  it("rejects a non-uuid portfolioId on updateMappingSchema", () => {
    expect(
      updateMappingSchema.safeParse({
        placementId: PLACEMENT_ID,
        portfolioId: "'; DROP TABLE",
        doneColumnId: null,
        doneOptionIds: [],
      }).success,
    ).toBe(false);
  });
});
