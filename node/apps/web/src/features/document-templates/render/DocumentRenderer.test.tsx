import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { presetLayout, templateLayoutSchema, type TemplateLayoutInput } from "@accountmanagement/contracts";
import { DocumentRenderer, DocumentStyles } from "./DocumentRenderer";
import { sampleDocument } from "./sample-document";

/**
 * The renderer draws thumbnails, previews and the printed page, so what it
 * shows here is what goes on paper.
 */

const layoutOf = (blocks: TemplateLayoutInput["rows"][number]["columns"][number]["blocks"]) =>
  templateLayoutSchema.parse({
    version: 1,
    page: {},
    styles: {},
    rows: [{ id: "r1", columns: [{ id: "c1", blocks }] }],
  });

const draw = (layout: ReturnType<typeof layoutOf>, document = sampleDocument("sales-invoice")) =>
  render(
    <>
      <DocumentStyles />
      <DocumentRenderer layout={layout} document={document} />
    </>,
  );

describe("DocumentRenderer", () => {
  it("draws the old invoice's content with the Classic layout", () => {
    draw(presetLayout("classic", "sales-invoice"));

    expect(screen.getByText("TAX INVOICE")).toBeInTheDocument();
    expect(screen.getAllByText("Your Company Name").length).toBeGreaterThan(0);
    expect(screen.getByText("Buyer (Bill to)")).toBeInTheDocument();
    expect(screen.getByText("Consignee (Ship to)")).toBeInTheDocument();
    expect(screen.getByText("OPC 53 Grade Cement")).toBeInTheDocument();
    expect(screen.getByText("Central Tax")).toBeInTheDocument();
    expect(screen.getByText("State Tax")).toBeInTheDocument();
    expect(screen.getByText("INR Two Lakh Sixty Nine Thousand Two Hundred Sixty Only")).toBeInTheDocument();
    expect(screen.getByText("INR Thirty Eight Thousand Two Hundred Sixty Only")).toBeInTheDocument();
    expect(screen.getByText("Authorised Signatory")).toBeInTheDocument();
    expect(screen.getByText("SMPL0000001")).toBeInTheDocument();
  });

  it("prints the items with the columns the block names, in that order", () => {
    draw(layoutOf([{ id: "t", type: "items-table", columns: ["index", "item", "quantity", "amount"] }]));

    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual(["#", "Item", "Qty", "Amount"]);
    expect(within(table).getByText("47,360.00")).toBeInTheDocument();
    // The total row adds up the line amounts: 47,360 + 1,65,200 + 56,700.
    expect(within(table).getByText("2,69,260.00")).toBeInTheDocument();
  });

  it("uses the document's own title, so a credit note says so", () => {
    draw(layoutOf([{ id: "t", type: "title" }]), { ...sampleDocument("sales-invoice"), title: "CREDIT NOTE" });
    expect(screen.getByText("CREDIT NOTE")).toBeInTheDocument();
  });

  it("prints a title the template sets instead", () => {
    draw(layoutOf([{ id: "t", type: "title", text: "BILL OF SUPPLY" }]));
    expect(screen.getByText("BILL OF SUPPLY")).toBeInTheDocument();
    expect(screen.queryByText("TAX INVOICE")).not.toBeInTheDocument();
  });

  it("leaves out header fields that are empty rather than printing blank rows", () => {
    const document = sampleDocument("sales-invoice");
    draw(
      layoutOf([{ id: "f", type: "document-fields", fields: ["number", "lr-no", "purchase-order-no"] }]),
      { ...document, fields: { ...document.fields, lrNo: null } },
    );

    expect(screen.getByText("Invoice No")).toBeInTheDocument();
    expect(screen.queryByText("LR No")).not.toBeInTheDocument();
    expect(screen.queryByText("PO No")).not.toBeInTheDocument();
  });

  it("leaves zero rows out of the totals, and always prints the total", () => {
    draw(layoutOf([{ id: "t", type: "totals", rows: ["subtotal", "tds", "round-off"] }]));

    expect(screen.getByText("Taxable amount")).toBeInTheDocument();
    expect(screen.queryByText("Less: TDS")).not.toBeInTheDocument();
    expect(screen.queryByText("Round off")).not.toBeInTheDocument();
    expect(screen.getByText("₹2,69,260.00")).toBeInTheDocument();
  });

  it("splits the GST into one integrated column when asked", () => {
    draw(layoutOf([{ id: "t", type: "tax-summary", split: "igst" }]));

    expect(screen.getByText("Integrated Tax")).toBeInTheDocument();
    expect(screen.queryByText("Central Tax")).not.toBeInTheDocument();
  });

  it("prints nothing for bank details the company does not have", () => {
    const document = sampleDocument("sales-invoice");
    const { container } = draw(layoutOf([{ id: "b", type: "bank-details" }]), {
      ...document,
      company: { ...document.company, bankName: null, bankBranch: null, accountNo: null, ifscCode: null },
    });

    expect(screen.queryByText("Bank details")).not.toBeInTheDocument();
    expect(container.querySelector(".dt-col")?.textContent).toBe("");
  });

  it("puts the template's colours and page size on the page", () => {
    const { container } = draw(
      templateLayoutSchema.parse({
        version: 1,
        page: { size: "A5", orientation: "landscape", marginMm: 8 },
        styles: { primaryColor: "#be185d" },
        rows: [],
      }),
    );
    const page = container.querySelector<HTMLElement>(".dt-page")!;

    expect(page.style.width).toBe("210mm");
    expect(page.style.minHeight).toBe("148mm");
    expect(page.style.padding).toBe("8mm");
    expect(page.style.getPropertyValue("--dt-primary")).toBe("#be185d");
  });
});
