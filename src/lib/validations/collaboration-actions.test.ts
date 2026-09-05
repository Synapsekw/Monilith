import { describe, it, expect } from "vitest";
import {
  addUpdateSchema,
  mentionTargetSchema,
  editUpdateSchema,
  deleteUpdateSchema,
  markNotificationReadSchema,
  createAttachmentSchema,
} from "@/lib/validations/collaboration-actions";

const ITEM = "11111111-1111-4111-8111-111111111111";
const UPD = "22222222-2222-4222-8222-222222222222";
const USER = "99999999-9999-4999-8999-999999999999";
const COL = "33333333-3333-4333-8333-333333333333";
const AGENT = "44444444-4444-4444-8444-444444444444";

describe("collaboration validation", () => {
  it("accepts a valid add-update payload", () => {
    const r = addUpdateSchema.safeParse({ itemId: ITEM, text: "hello" });
    expect(r.success).toBe(true);
  });
  it("rejects empty text", () => {
    expect(addUpdateSchema.safeParse({ itemId: ITEM, text: "" }).success).toBe(
      false,
    );
  });
  it("rejects a non-uuid itemId", () => {
    expect(
      addUpdateSchema.safeParse({ itemId: "nope", text: "x" }).success,
    ).toBe(false);
  });
  it("validates edit + delete payloads", () => {
    expect(
      editUpdateSchema.safeParse({ updateId: UPD, text: "edited" }).success,
    ).toBe(true);
    expect(deleteUpdateSchema.safeParse({ updateId: UPD }).success).toBe(true);
    expect(deleteUpdateSchema.safeParse({ updateId: "bad" }).success).toBe(
      false,
    );
  });
});

describe("mentions + notifications validation", () => {
  it("accepts an add-update with tagged mention targets", () => {
    expect(
      addUpdateSchema.safeParse({
        itemId: ITEM,
        text: "hi @Ada @ops",
        mentions: [
          { kind: "user", userId: USER },
          { kind: "agent", agentId: AGENT },
        ],
      }).success,
    ).toBe(true);
  });
  it("defaults mentions to empty when omitted", () => {
    const r = addUpdateSchema.parse({ itemId: ITEM, text: "hi" });
    expect(r.mentions).toEqual([]);
  });
  it("rejects an untagged (bare uuid) mention", () => {
    expect(
      addUpdateSchema.safeParse({
        itemId: ITEM,
        text: "hi",
        mentions: [USER],
      }).success,
    ).toBe(false);
  });
  it("rejects an unknown mention kind", () => {
    expect(
      addUpdateSchema.safeParse({
        itemId: ITEM,
        text: "hi",
        mentions: [{ kind: "board", boardId: USER }],
      }).success,
    ).toBe(false);
  });
  it("rejects a non-uuid mention", () => {
    expect(
      addUpdateSchema.safeParse({
        itemId: ITEM,
        text: "hi",
        mentions: [{ kind: "user", userId: "nope" }],
      }).success,
    ).toBe(false);
  });
  it("rejects more than 20 mentions", () => {
    const many = Array.from({ length: 21 }, () => ({
      kind: "user",
      userId: crypto.randomUUID(),
    }));
    expect(
      addUpdateSchema.safeParse({
        itemId: ITEM,
        text: "x",
        mentions: many,
      }).success,
    ).toBe(false);
    expect(
      addUpdateSchema.safeParse({
        itemId: ITEM,
        text: "x",
        mentions: many.slice(0, 20),
      }).success,
    ).toBe(true);
  });
  it("parses a single target through mentionTargetSchema", () => {
    expect(
      mentionTargetSchema.safeParse({ kind: "agent", agentId: AGENT }).success,
    ).toBe(true);
    expect(
      mentionTargetSchema.safeParse({ kind: "agent", userId: AGENT }).success,
    ).toBe(false);
  });
  it("validates mark-read", () => {
    expect(
      markNotificationReadSchema.safeParse({ notificationId: USER }).success,
    ).toBe(true);
    expect(
      markNotificationReadSchema.safeParse({ notificationId: "bad" }).success,
    ).toBe(false);
  });
});

describe("createAttachment columnId", () => {
  const base = {
    itemId: ITEM,
    storagePath: "org/board/file.png",
    fileName: "file.png",
    mimeType: "image/png",
    sizeBytes: 1024,
  };

  it("accepts an attachment without a columnId (item-level)", () => {
    expect(createAttachmentSchema.safeParse(base).success).toBe(true);
  });

  it("accepts an optional columnId uuid (Files-column attachment)", () => {
    expect(
      createAttachmentSchema.safeParse({ ...base, columnId: COL }).success,
    ).toBe(true);
  });

  it("rejects a non-uuid columnId", () => {
    expect(
      createAttachmentSchema.safeParse({ ...base, columnId: "nope" }).success,
    ).toBe(false);
  });
});
