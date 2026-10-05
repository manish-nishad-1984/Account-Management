import { z } from "zod";
import { money, optionalMoney, optionalText, uuidId } from "./fields";
import { rowCapabilitiesSchema } from "./pagination";

/**
 * Payout lists (client request, 5 Oct 2026).
 *
 * The owner says what he can pay out today - "I have 40 lakh" - and the office
 * works out which suppliers to pay and how much of each. That choice is kept as
 * a list: party name, amount, and the total at the end. It is asked for again
 * five days later, or the same day, and sometimes it has to be changed. It is
 * then sent on WhatsApp.
 *
 * A LIST IS A PLAN, NOT A PAYMENT. Nothing here moves the ledger; the payment is
 * still entered on the Payments screen. That separation is deliberate: a plan
 * that quietly became a payment would be a way to pay a supplier without the
 * payment ever being keyed.
 *
 * ONE LINE PER PARTY. The owner asks for "party name and amount", and the
 * Pending Outstanding report is already party-wise. The amount is whatever is
 * chosen, and it MAY BE LESS than the party's outstanding (a part payment, the
 * client confirmed). It may not be zero or negative.
 *
 * WHERE THE OUTSTANDING COMES FROM. The same arithmetic as the Pending
 * Outstanding report - credits less debits, summed over sites - so the two
 * screens agree for the same party. Only parties that are owed money are offered.
 */

const LIST_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const payoutLineInputSchema = z.object({
  partyId: uuidId,
  amount: money("Amount").refine((value) => Number.parseFloat(value) > 0, {
    message: "The amount must be more than zero",
  }),
});
export type PayoutLineInput = z.infer<typeof payoutLineInputSchema>;

/** The same shape creates a list and replaces one: a PATCH sends the whole list. */
export const createPayoutListSchema = z
  .object({
    /** `YYYY-MM-DD`: the day the list is for, not the day it was typed. */
    listDate: z.string().trim().regex(LIST_DATE_PATTERN, "Choose a date"),
    title: optionalText(120),
    /** What the owner has to spend, when he said. Informational; not a cap. */
    budget: optionalMoney("Budget"),
    note: optionalText(1000),
    lines: z.array(payoutLineInputSchema).min(1, "Add at least one party").max(500),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.lines.forEach((line, index) => {
      if (seen.has(line.partyId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lines", index, "partyId"],
          message: "This party is already in the list",
        });
      }
      seen.add(line.partyId);
    });
  });
export type CreatePayoutList = z.infer<typeof createPayoutListSchema>;

export const updatePayoutListSchema = createPayoutListSchema;
export type UpdatePayoutList = CreatePayoutList;

export const payoutListRowSchema = z.object({
  id: z.string(),
  listDate: z.string(),
  title: z.string().nullable(),
  budget: z.string().nullable(),
  /** The sum of the line amounts. */
  total: z.string(),
  partyCount: z.number().int().nonnegative(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
  updatedByName: z.string().nullable(),
  capabilities: rowCapabilitiesSchema,
});
export type PayoutListRow = z.infer<typeof payoutListRowSchema>;

export const payoutLineSchema = z.object({
  id: z.string(),
  partyId: z.string(),
  partyName: z.string(),
  /** What was chosen to be paid. */
  amount: z.string(),
  /**
   * What the party was owed when this line was last saved, so the list still
   * reads as it did on the day. Null on a line saved before it was recorded.
   */
  outstandingAtSave: z.string().nullable(),
  /**
   * What the party is owed NOW, from the ledger, or "0" when nothing is owed.
   * A list read days later needs it: if it is below `amount`, the party has been
   * paid since and the line is out of date.
   */
  outstandingNow: z.string(),
});
export type PayoutLine = z.infer<typeof payoutLineSchema>;

export const payoutListDetailSchema = payoutListRowSchema.omit({ capabilities: true }).extend({
  note: z.string().nullable(),
  lines: z.array(payoutLineSchema),
});
export type PayoutListDetail = z.infer<typeof payoutListDetailSchema>;

/** A party that is owed money, for building a list. */
export const payoutOutstandingRowSchema = z.object({
  partyId: z.string(),
  partyName: z.string(),
  outstanding: z.string(),
});
export type PayoutOutstandingRow = z.infer<typeof payoutOutstandingRowSchema>;

export const payoutOutstandingResponseSchema = z.object({
  rows: z.array(payoutOutstandingRowSchema),
  /** The sum of `outstanding` over every row. */
  total: z.string(),
});
export type PayoutOutstandingResponse = z.infer<typeof payoutOutstandingResponseSchema>;
