import { describe, expect, it } from "vitest";
import {
  allocate,
  allocationError,
  type DeliveryAllocationLine,
} from "./delivery-allocation.js";

/**
 * The legacy check, transcribed from `PurchaseRequestScript.js:964-1006`.
 *
 * An ORACLE, not an implementation — it exists so the departure this module
 * makes is measured against what the browser actually does rather than against
 * what this file's author remembers of it. Note the two independent
 * accumulators; that is the whole defect.
 */
function legacyRefuses(lines: DeliveryAllocationLine[], ordered: string): boolean {
  const totalProductQuantity = Number.parseFloat(ordered) || 0;
  let totalShippingQuantity = 0;
  let totalGroupQuantity = 0;
  let hasError = false;

  for (const line of lines.filter((l) => l.kind === "site")) {
    totalShippingQuantity += Number.parseFloat(line.quantity) || 0;
    if (totalShippingQuantity > totalProductQuantity) hasError = true;
  }
  for (const line of lines.filter((l) => l.kind === "group")) {
    totalGroupQuantity += Number.parseFloat(line.quantity) || 0;
    if (totalGroupQuantity > totalProductQuantity) {
      hasError = true;
      break;
    }
  }

  return hasError;
}

describe("allocate", () => {
  it("adds both panels into one allocated total", () => {
    const result = allocate(
      [
        { kind: "site", quantity: "30" },
        { kind: "group", quantity: "20.50" },
      ],
      "100",
    );

    expect(result.allocated).toBe("50.50");
    expect(result.byKind).toEqual({ site: "30.00", group: "20.50" });
    expect(result.ordered).toBe("100.00");
    expect(result.remaining).toBe("49.50");
    expect(result.exceedsOrder).toBe(false);
  });

  it("allows an order to be only part allocated", () => {
    // The source allows this too. A purchase order whose deliveries are not yet
    // decided is an ordinary state, not a mistake.
    const result = allocate([{ kind: "site", quantity: "1" }], "100");
    expect(result.exceedsOrder).toBe(false);
    expect(result.remaining).toBe("99.00");
  });

  it("allows exactly the ordered quantity", () => {
    const result = allocate(
      [
        { kind: "site", quantity: "60" },
        { kind: "group", quantity: "40" },
      ],
      "100",
    );
    expect(result.allocated).toBe("100.00");
    expect(result.remaining).toBe("0.00");
    expect(result.exceedsOrder).toBe(false);
  });

  it("refuses more than was ordered", () => {
    const result = allocate([{ kind: "site", quantity: "100.01" }], "100");
    expect(result.exceedsOrder).toBe(true);
    expect(result.remaining).toBe("-0.01");
  });

  it("treats no deliveries as a valid allocation", () => {
    const result = allocate([], "100");
    expect(result.allocated).toBe("0.00");
    expect(result.exceedsOrder).toBe(false);
  });

  it("is exact where a float sum would not be", () => {
    // 0.1 + 0.2 is 0.30000000000000004 in float, which is greater than 0.3 and
    // would refuse this allocation. The whole point of decimals.
    const result = allocate(
      [
        { kind: "site", quantity: "0.10" },
        { kind: "group", quantity: "0.20" },
      ],
      "0.30",
    );
    expect(result.allocated).toBe("0.30");
    expect(result.exceedsOrder).toBe(false);
  });
});

describe("the departure from the source", () => {
  /**
   * The case the whole module exists for.
   *
   * 100 to site addresses and 100 more to group addresses, against an order for
   * 100. Neither of the source's two accumulators exceeds the order on its own,
   * so it saves — booking 200 units of deliveries against 100 units ordered.
   */
  it("catches a double allocation the source lets through", () => {
    const lines: DeliveryAllocationLine[] = [
      { kind: "site", quantity: "100" },
      { kind: "group", quantity: "100" },
    ];

    expect(legacyRefuses(lines, "100")).toBe(false);

    const result = allocate(lines, "100");
    expect(result.allocated).toBe("200.00");
    expect(result.exceedsOrder).toBe(true);
  });

  it("agrees with the source everywhere one panel is used alone", () => {
    // The departure is confined to allocations that use BOTH panels. With one
    // panel the two implementations are the same rule, and that is worth
    // pinning: it bounds what the change can affect.
    for (const kind of ["site", "group"] as const) {
      for (const [quantity, ordered] of [
        ["50", "100"],
        ["100", "100"],
        ["101", "100"],
        ["0", "100"],
      ]) {
        const lines: DeliveryAllocationLine[] = [{ kind, quantity }];
        expect(allocate(lines, ordered).exceedsOrder).toBe(legacyRefuses(lines, ordered));
      }
    }
  });
});

describe("allocationError", () => {
  it("says nothing when the allocation fits", () => {
    expect(allocationError(allocate([{ kind: "site", quantity: "10" }], "100"))).toBeNull();
  });

  it("names both totals and how much to remove", () => {
    const message = allocationError(
      allocate(
        [
          { kind: "site", quantity: "100" },
          { kind: "group", quantity: "100" },
        ],
        "100",
      ),
    );

    expect(message).toBe(
      "The delivery addresses account for 200.00 units, and the order is for 100.00. " +
        "Reduce the quantities by 100.00.",
    );
  });
});
