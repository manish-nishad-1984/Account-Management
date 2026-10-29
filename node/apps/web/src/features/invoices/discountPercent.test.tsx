import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PurchaseInvoiceFormDialog } from "../purchase-invoices/PurchaseInvoiceFormDialog";
import { renderWithAuth, routeFetch } from "../../test/render";
import { discountFromPercent } from "./InvoiceLineGrid";

/** "50%" in Disc/unit is half the price, in rupees per unit (client, 29 Oct 2026). */

const list = (rows: unknown[]) => ({ rows, nextCursor: null, total: rows.length });
const CAPS = { canEdit: true, canDelete: true, canApprove: false };

describe("a discount typed as a percent", () => {
  it("is that percent of the price, rounded to paise half up", () => {
    expect(discountFromPercent("50%", "400")).toBe("200.00");
    expect(discountFromPercent(" 44 % ", "422")).toBe("185.68");
    expect(discountFromPercent("12.5%", "2500.00")).toBe("312.50");
    expect(discountFromPercent("33.33%", "10")).toBe("3.33");
  });

  it("is left alone when it is rupees, not a percent, or there is no price yet", () => {
    expect(discountFromPercent("50", "400")).toBeNull();
    expect(discountFromPercent("150%", "400")).toBeNull();
    expect(discountFromPercent("abc%", "400")).toBeNull();
    expect(discountFromPercent("50%", "")).toBeNull();
  });

  describe("on the invoice form", () => {
    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn());
      routeFetch([
        [/\/sites\/assignable$/, { scope: "all", sites: [] }],
        [/\/units/, list([{ id: 1, name: "Bag", itemCount: 0, capabilities: CAPS }])],
        [/\/items$/, list([])],
        [/\/suppliers/, list([])],
        [/\/companies/, list([])],
        [/\/purchase-orders/, list([])],
      ]);
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });
    const open = () =>
      renderWithAuth(<PurchaseInvoiceFormDialog open invoiceId={null} onClose={() => {}} />, {
        permissions: ["purchase-invoice.view", "purchase-invoice.add", "item.view"],
      });

    it("turns into rupees when the box is left", async () => {
      const user = userEvent.setup();
      open();
      await user.type(await screen.findByLabelText(/price on line 1/i), "400");
      const discount = screen.getByLabelText(/discount per unit on line 1/i);
      await user.type(discount, "50%");
      await user.tab();
      expect(discount).toHaveValue("200.00");
      expect(screen.getByTitle(/discount as a percent/i)).toHaveTextContent("50.00%");
    });

    it("waits for a price typed after it", async () => {
      const user = userEvent.setup();
      open();
      const discount = await screen.findByLabelText(/discount per unit on line 1/i);
      await user.type(discount, "10%");
      await user.tab();
      expect(discount).toHaveValue("10%");
      await user.type(screen.getByLabelText(/price on line 1/i), "2500");
      await user.tab();
      expect(discount).toHaveValue("250.00");
    });
  });
});
