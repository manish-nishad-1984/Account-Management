/**
 * How much of a purchase order goes to each delivery address.
 *
 * The legacy Create Purchase Order screen carries two address panels below the
 * line grid — "Shipping Addresses", listing the site's own addresses, and "Group
 * Address", listing the addresses of the chosen site group. Each row is a
 * checkbox and a quantity box, and the ticked rows are posted as one list.
 *
 * THE RULE THE SOURCE MEANT TO ENFORCE
 *
 * `PurchaseRequestScript.js:964-1006` refuses a save when the delivery quantity
 * exceeds the quantity ordered — you cannot send 120 units to addresses when the
 * order is for 100. That rule is right and it is reproduced here.
 *
 * THE DEFECT IN HOW IT IS ENFORCED, and the one departure in this file
 *
 * The source keeps TWO accumulators and compares each against the order total
 * independently:
 *
 *   var totalShippingQuantity = 0;
 *   var totalGroupQuantity = 0;
 *   $(".shipping-checkbox:checked").each(...)      // totalShippingQuantity > totalProductQuantity
 *   $(".GroupAddress-Checkbox:checked").each(...)  // totalGroupQuantity   > totalProductQuantity
 *
 * So an order for 100 units passes with 100 allocated to site addresses AND 100
 * more allocated to group addresses — 200 units of deliveries against 100 units
 * ordered, with no warning anywhere. Both halves land in the same table and are
 * printed on the same order.
 *
 * Here the two kinds are summed TOGETHER and the one total is compared once.
 * That is the rule the source states, applied to the number it was always about.
 * It is a departure and it is flagged for sign-off: it refuses saves the old
 * screen accepted. It cannot silently change an existing order, because nothing
 * recomputes an order that is not being edited.
 *
 * WHY THIS IS NOT IN `contracts`
 *
 * It compares sums of decimal strings, and this package is where decimal
 * arithmetic lives. Doing it in a Zod refinement would mean either parsing money
 * to a float in the validation layer — the one thing this system does not do
 * anywhere — or giving `contracts` a dependency on `domain` for one rule.
 *
 * Both the API and the form call this, so the browser and the server refuse the
 * same allocation with the same sentence.
 */

import { type Decimal, decimal, compare, format, sum } from "./money.js";

/** Which panel an address came from. Two panels, one stored list. */
export type DeliveryAddressKind = "site" | "group";

export interface DeliveryAllocationLine {
  kind: DeliveryAddressKind;
  /** Decimal string, as every quantity in this system is. */
  quantity: string;
}

export interface DeliveryAllocation {
  /** Everything allocated, both kinds together. */
  allocated: string;
  /** What the order's lines add up to. */
  ordered: string;
  /** `ordered - allocated`. Negative when over-allocated. */
  remaining: string;
  /** Allocated by panel, so a screen can show each total under its own list. */
  byKind: Record<DeliveryAddressKind, string>;
  /** True when `allocated` exceeds `ordered`. The condition that refuses a save. */
  exceedsOrder: boolean;
}

const d = (value: string | null | undefined): Decimal => decimal(value ?? "0");

/**
 * Total the deliveries against the order.
 *
 * `orderedQuantity` is the sum of the line quantities — the same number the
 * grid's quantity footer shows, so what the user is checked against is what the
 * user can see.
 */
export function allocate(
  lines: readonly DeliveryAllocationLine[],
  orderedQuantity: string,
): DeliveryAllocation {
  const site = sum(lines.filter((line) => line.kind === "site").map((line) => d(line.quantity)));
  const group = sum(lines.filter((line) => line.kind === "group").map((line) => d(line.quantity)));

  const allocated = site + group;
  const ordered = d(orderedQuantity);

  return {
    allocated: format(allocated),
    ordered: format(ordered),
    remaining: format(ordered - allocated),
    byKind: { site: format(site), group: format(group) },
    // Strictly greater. Allocating exactly the ordered quantity is the normal
    // case, and allocating less is allowed — the source allows it too, and a
    // part-allocated order is a real thing rather than a mistake.
    exceedsOrder: compare(allocated, ordered) > 0,
  };
}

/**
 * The sentence shown when an allocation is refused, or null when it is fine.
 *
 * One sentence in one place, so the form's inline message and the API's 400 say
 * the same thing. A validation message that differs between the two reads as two
 * different problems.
 */
export function allocationError(allocation: DeliveryAllocation): string | null {
  if (!allocation.exceedsOrder) return null;

  return (
    `The delivery addresses account for ${allocation.allocated} units, ` +
    `and the order is for ${allocation.ordered}. ` +
    `Reduce the quantities by ${format(-decimal(allocation.remaining))}.`
  );
}
