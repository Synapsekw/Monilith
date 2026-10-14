import { z } from "zod";

export const allowedLinks = [
  "#product",
  "#agents",
  "#pricing",
  "https://www.monolith.works/signup",
] as const;
const linkSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    href: z.enum(allowedLinks),
  })
  .strict();
export const answerSchema = z
  .object({
    reply: z.string().trim().min(1).max(8000),
    summary: z.string().max(1500),
    offer_contact: z.boolean(),
    links: z.array(linkSchema).max(4),
  })
  .strict();
export const chatResultSchema = z
  .object({
    reply: answerSchema.shape.reply,
    links: answerSchema.shape.links,
    contact_request: z.object({}).strict().optional(),
  })
  .strict();
export const receiptSchema = z
  .object({
    delivery: z.enum(["accepted", "failed", "unknown"]),
    request_id: z.string().regex(/^[a-zA-Z0-9_-]{16,80}$/),
    reference: z.string().max(17),
    reply: z.string().max(500),
  })
  .strict();
export type CallbackReceipt = z.infer<typeof receiptSchema>;
const messageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(8000),
    links: answerSchema.shape.links.optional(),
    contact_request: z.object({}).strict().optional(),
  })
  .strict();
export type MonoMessage = z.infer<typeof messageSchema>;
const expiresAt = z.number().int().positive().safe();
export const sessionSchema = z
  .object({
    kind: z.literal("session"),
    token: z.string().regex(/^[0-9a-f]{64}$/),
    history: z.array(messageSchema).max(40),
    active: z
      .object({ id: receiptSchema.shape.request_id, until: expiresAt })
      .strict()
      .nullable(),
    lastRequestId: receiptSchema.shape.request_id.nullable().optional(),
    lastCallback: z.string().max(200).optional(),
    callbackReceipt: receiptSchema.optional(),
    expiresAt,
  })
  .strict();
export const operationSchema = z
  .object({
    kind: z.literal("operation"),
    id: receiptSchema.shape.request_id,
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    state: z.enum(["pending", "done", "failed"]),
    result: z.union([chatResultSchema, receiptSchema]).optional(),
    report: z
      .enum(["pending", "disabled", "accepted", "failed", "unknown"])
      .optional(),
    expiresAt,
  })
  .strict();
export const rateSchema = z
  .object({
    kind: z.literal("rate"),
    count: z.number().int().nonnegative().max(100000),
    expiresAt,
  })
  .strict();
export const recordSchema = z.discriminatedUnion("kind", [
  sessionSchema,
  operationSchema,
  rateSchema,
]);
export type Session = z.infer<typeof sessionSchema>;
export type Operation = z.infer<typeof operationSchema>;

const field = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))
    .default("");
export const leadSchema = z
  .object({
    name: field(100),
    phone: field(40),
    email: field(254),
    reason: field(1000),
    company: field(120),
    preferred_time: field(160),
    timezone: field(80),
  })
  .strict()
  .refine(
    (lead) => !!lead.name && !!lead.reason && (!!lead.phone || !!lead.email),
  )
  .refine(
    (lead) => !lead.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email),
  )
  .refine(
    (lead) =>
      !lead.phone ||
      /^\+[1-9][0-9]{6,14}$/.test(lead.phone.replace(/[\s().-]/g, "")),
  );
const requestBase = {
  request_id: receiptSchema.shape.request_id,
  page: z.string().max(180).default(""),
};
export const chatInputSchema = z
  .object({ ...requestBase, message: z.string().trim().min(1).max(2000) })
  .strict();
export const callbackInputSchema = z
  .object({ ...requestBase, confirmed: z.literal(true), lead: leadSchema })
  .strict();
export const resetInputSchema = z.object({}).strict();
