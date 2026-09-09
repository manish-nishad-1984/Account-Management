import { describe, expect, it } from "vitest";
import {
  DELIVERY_ADDRESS_KINDS,
  createPurchaseOrderSchema,
  purchaseOrderDeliveryAddressInputSchema,
} from "./purchase-orders";

const LINE = {
  itemId: "",
  itemName: "Cement",
  unitId: 1,
  quantity: "10",
  unitPrice: "100.00",
  gstPercent: "18",
};

const ORDER = {
  siteId: "8f1a0f2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f",
  supplierId: "1f1a0f2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f",
  companyId: "2f1a0f2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f",
  items: [LINE],
};

describe("a delivery address", () => {
  it("takes the two kinds the two panels produce", () => {
    expect(DELIVERY_ADDRESS_KINDS).toEqual(["site", "group"]);
    for (const kind of DELIVERY_ADDRESS_KINDS) {
      const parsed = purchaseOrderDeliveryAddressInputSchema.parse({
        kind,
        address: "Plot 4, GIDC",
        quantity: "5",
      });
      expect(parsed.kind).toBe(kind);
    }
  });

  it("refuses a kind that is neither panel", () => {
    const result = purchaseOrderDeliveryAddressInputSchema.safeParse({
      kind: "warehouse",
      address: "Plot 4",
      quantity: "5",
    });
    expect(result.success).toBe(false);
  });

  it("requires an address, because an empty one is not a destination", () => {
    const result = purchaseOrderDeliveryAddressInputSchema.safeParse({
      kind: "site",
      address: "   ",
      quantity: "5",
    });
    expect(result.success).toBe(false);
  });

  /**
   * The source column is `int?` while the browser collects the value with
   * `parseFloat`, so a decimal delivery quantity is rounded by SQL Server on the
   * way in and the deliveries then do not add up to the order they came from.
   */
  it("keeps a decimal quantity that the source would round to a whole number", () => {
    const parsed = purchaseOrderDeliveryAddressInputSchema.parse({
      kind: "group",
      address: "Ward 3",
      quantity: "2.50",
    });
    expect(parsed.quantity).toBe("2.50");
  });

  it("refuses a quantity of zero, as every other quantity in the system is refused", () => {
    const result = purchaseOrderDeliveryAddressInputSchema.safeParse({
      kind: "site",
      address: "Plot 4",
      quantity: "0",
    });
    expect(result.success).toBe(false);
  });

  it("refuses a negative quantity", () => {
    const result = purchaseOrderDeliveryAddressInputSchema.safeParse({
      kind: "site",
      address: "Plot 4",
      quantity: "-1",
    });
    expect(result.success).toBe(false);
  });

  /**
   * The source encodes the panel a row came from as a `"Group-"` prefix on the
   * address text, then strips it with `Replace` — which removes the marker
   * wherever it appears. An address that legitimately contains that text comes
   * back mangled. Here the address is stored exactly as typed.
   */
  it("stores an address containing the source's own marker unchanged", () => {
    const parsed = purchaseOrderDeliveryAddressInputSchema.parse({
      kind: "group",
      address: "Ward 3, Group-B Quarters",
      quantity: "1",
    });
    expect(parsed.address).toBe("Ward 3, Group-B Quarters");
  });
});

describe("delivery addresses on the create contract", () => {
  it("defaults to none, because an order need not say where it goes yet", () => {
    expect(createPurchaseOrderSchema.parse(ORDER).deliveryAddresses).toEqual([]);
  });

  it("carries both panels' rows in one list", () => {
    const parsed = createPurchaseOrderSchema.parse({
      ...ORDER,
      deliveryAddresses: [
        { kind: "site", address: "Plot 4, GIDC", quantity: "6" },
        { kind: "group", address: "Ward 3", quantity: "4" },
      ],
    });
    expect(parsed.deliveryAddresses).toHaveLength(2);
    expect(parsed.deliveryAddresses.map((row) => row.kind)).toEqual(["site", "group"]);
  });

  it("caps the list", () => {
    const result = createPurchaseOrderSchema.safeParse({
      ...ORDER,
      deliveryAddresses: Array.from({ length: 101 }, () => ({
        kind: "site",
        address: "Plot 4",
        quantity: "1",
      })),
    });
    expect(result.success).toBe(false);
  });

  /**
   * The quantity-versus-order rule lives in `packages/domain`, not here — see the
   * comment on the field. This pins that the contract alone does NOT refuse an
   * over-allocation, so nobody reads a green contract test as covering it.
   */
  it("does not itself check the quantities against the order", () => {
    const parsed = createPurchaseOrderSchema.parse({
      ...ORDER,
      deliveryAddresses: [{ kind: "site", address: "Plot 4", quantity: "9999" }],
    });
    expect(parsed.deliveryAddresses[0]?.quantity).toBe("9999");
  });
});
