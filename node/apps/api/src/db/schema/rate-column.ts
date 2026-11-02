import { customType } from "drizzle-orm/pg-core";

/**
 * A RATE column: `numeric(18, 3)` (client, 2 Nov 2026 - steel at 75.325 a kilo;
 * migration 0036 widened the price columns from two places).
 *
 * PostgreSQL hands every value back with all three places, so each price kept
 * before the change would come back as "75.300" - in the edit boxes, the exports
 * and every comparison with "75.30". The third place is dropped when it is a zero:
 * a rate reads exactly as it did, unless it really has one.
 */
export const rateNumeric = customType<{ data: string; driverData: string }>({
  dataType: () => "numeric(18, 3)",
  fromDriver: (value) => String(value).replace(/^(-?\d+\.\d{2})0$/, "$1"),
  toDriver: (value) => value,
});
