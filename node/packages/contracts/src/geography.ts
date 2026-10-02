import { z } from "zod";

/**
 * States and cities for an address picker — the first screen to pick them from
 * a list rather than carry a bare id (the Agency Master, 1 Oct 2026).
 */
export const stateOptionSchema = z.object({ id: z.number().int(), name: z.string() });
export type StateOption = z.infer<typeof stateOptionSchema>;

export const cityOptionSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  stateId: z.number().int(),
});
export type CityOption = z.infer<typeof cityOptionSchema>;

/**
 * A geography reference that MUST be chosen.
 *
 * `geographyId` in fields.ts is optional, and coerces `""` to 0, which would
 * then fail `positive()` with Zod's own wording. An untouched select submits
 * `""`, so it is mapped to absent first and both cases say "Choose one".
 */
export const requiredGeographyId = (label: string) =>
  z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? undefined : Number(value)),
    z
      .number({ required_error: `Choose a ${label}`, invalid_type_error: `Choose a ${label}` })
      .int()
      .positive(`Choose a ${label}`),
  );
