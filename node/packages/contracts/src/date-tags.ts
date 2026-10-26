import { z } from "zod";

/**
 * A date range kept under a name on the Excel Export (client, 26 Oct 2026), so
 * a filter used again is one click. Each person's own.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const saveDateTagSchema = z
  .object({
    name: z.string().trim().min(1, "Give the tag a name").max(40, "At most 40 letters"),
    fromDate: z.string().regex(DAY).nullable(),
    toDate: z.string().regex(DAY).nullable(),
  })
  .refine((tag) => !tag.fromDate || !tag.toDate || tag.fromDate <= tag.toDate, {
    message: "The from-date is after the to-date",
    path: ["toDate"],
  });
export type SaveDateTag = z.infer<typeof saveDateTagSchema>;

export const dateTagSchema = z.object({
  id: z.string(),
  name: z.string(),
  fromDate: z.string().nullable(),
  toDate: z.string().nullable(),
});
export type DateTag = z.infer<typeof dateTagSchema>;
export const dateTagListSchema = z.object({ tags: z.array(dateTagSchema) });
