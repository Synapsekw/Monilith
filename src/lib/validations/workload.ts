import { z } from "zod";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date");
const weekday = z.number().int().min(1).max(7);
const workingDays = z.array(weekday).max(7);
const hoursPerDay = z.number().min(0).max(24);

export const upsertMemberCapacitySchema = z.object({
  userId: uuid,
  hoursPerDay,
  workingDays,
});

export const setWorkloadDefaultsSchema = z.object({
  defaultHoursPerDay: hoursPerDay,
  defaultPerItemHours: z.number().min(0),
  defaultWorkingDays: workingDays,
});

export const workloadWindowSchema = z.object({
  from: isoDate,
  to: isoDate,
});
