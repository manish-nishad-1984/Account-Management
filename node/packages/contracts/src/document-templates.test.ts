import { describe, expect, it } from "vitest";
import {
  DOCUMENT_TYPES,
  TEMPLATE_PRESETS,
  presetLayout,
  printTitle,
  templateLayoutSchema,
} from "./document-templates";

describe("starter layouts", () => {
  const every = DOCUMENT_TYPES.flatMap((type) => TEMPLATE_PRESETS.map((preset) => [preset, type] as const));

  it.each(every)("%s for %s is a valid layout", (preset, type) => {
    const layout = presetLayout(preset, type);
    expect(templateLayoutSchema.parse(layout)).toEqual(layout);
  });

  /**
   * The editor finds a block by its id, so two blocks sharing one would make a
   * click on one select the other.
   */
  it.each(every)("%s for %s gives every row, column and block its own id", (preset, type) => {
    const layout = presetLayout(preset, type);
    const ids = layout.rows.flatMap((row) => [
      row.id,
      ...row.columns.flatMap((column) => [column.id, ...column.blocks.map((block) => block.id)]),
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is the same layout every time it is asked for", () => {
    expect(presetLayout("classic", "sales-invoice")).toEqual(presetLayout("classic", "sales-invoice"));
  });

  /** The old invoice: HSN, CGST/SGST, both amounts in words, bank, signatory. */
  it("gives Classic everything the old printed invoice had", () => {
    const blocks = presetLayout("classic", "sales-invoice").rows.flatMap((row) =>
      row.columns.flatMap((column) => column.blocks),
    );
    const types = blocks.map((block) => block.type);

    expect(types).toEqual(
      expect.arrayContaining(["company", "party", "shipping", "items-table", "tax-summary", "bank-details", "signature"]),
    );
    expect(blocks.filter((block) => block.type === "amount-in-words").map((block) => "show" in block && block.show)).toEqual(["amount", "tax"]);
    const tax = blocks.find((block) => block.type === "tax-summary");
    expect(tax).toMatchObject({ split: "cgst-sgst" });
  });
});

describe("a stored layout", () => {
  it("fills in what an older or partial layout leaves out", () => {
    const layout = templateLayoutSchema.parse({
      version: 1,
      page: {},
      styles: {},
      rows: [{ id: "r1", columns: [{ id: "c1", blocks: [{ id: "b1", type: "signature" }] }] }],
    });

    expect(layout.page).toEqual({ size: "A4", orientation: "portrait", marginMm: 10 });
    expect(layout.rows[0]!.columns[0]).toMatchObject({
      weight: 1,
      blocks: [{ type: "signature", label: "Authorised Signatory", showCompany: true, align: "right" }],
    });
  });

  it("refuses a block type it does not know", () => {
    const result = templateLayoutSchema.safeParse({
      version: 1,
      page: {},
      styles: {},
      rows: [{ id: "r1", columns: [{ id: "c1", blocks: [{ id: "b1", type: "script" }] }] }],
    });
    expect(result.success).toBe(false);
  });

  it("refuses more than three columns in a row", () => {
    const column = (id: string) => ({ id, blocks: [] });
    const result = templateLayoutSchema.safeParse({
      version: 1,
      page: {},
      styles: {},
      rows: [{ id: "r1", columns: [column("a"), column("b"), column("c"), column("d")] }],
    });
    expect(result.success).toBe(false);
  });

  it("refuses a colour that is not a hex colour", () => {
    const result = templateLayoutSchema.safeParse({
      version: 1,
      page: {},
      styles: { primaryColor: "red; background:url(x)" },
      rows: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("printTitle", () => {
  it.each([
    ["sales-invoice", "Sales", "TAX INVOICE"],
    ["sales-invoice", "Credit Note", "CREDIT NOTE"],
    ["sales-invoice", "Sales Return", "SALES RETURN"],
    ["purchase-invoice", "Purchase", "PURCHASE INVOICE"],
    ["purchase-invoice", "Purchase Return", "PURCHASE RETURN"],
    ["purchase-invoice", "Credit Note", "CREDIT NOTE"],
  ] as const)("%s of type %s is titled %s", (documentType, invoiceType, title) => {
    expect(printTitle(documentType, invoiceType)).toBe(title);
  });
});
