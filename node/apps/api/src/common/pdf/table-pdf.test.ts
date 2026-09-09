import { describe, expect, it } from "vitest";
import { renderTablePdf, toRenderable, type PdfTableColumn } from "./table-pdf";

const COLUMNS: PdfTableColumn[] = [
  { header: "Document", width: 26, align: "left" },
  { header: "Supplier", width: 28, align: "left" },
  { header: "Credit", width: 16, align: "right" },
];

const render = (rows: string[][], footer?: string[]) =>
  renderTablePdf({
    title: "Supplier ledger",
    captions: [{ label: "Site", value: "Akwada Lake Front" }],
    columns: COLUMNS,
    rows,
    footer,
    generatedOn: new Date("2026-09-09T00:00:00.000Z"),
  });

/**
 * The PDF is a binary the test cannot meaningfully diff, so these check the
 * things that actually go wrong: that it is a PDF at all, that it grows a page
 * when the rows do, and that the text-mangling rules hold. Layout is checked by
 * looking at a rendered file, not here.
 */
describe("renderTablePdf", () => {
  it("produces a PDF", async () => {
    const bytes = await render([["DHP/24-25/049 (Purchase)", "Om Sagar Traders", "60,745.28"]]);
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(500);
  });

  it("carries the title in the document metadata, so a saved file is identifiable", async () => {
    const bytes = await render([["a", "b", "1.00"]]);
    expect(bytes.toString("latin1")).toContain("Supplier ledger");
  });

  it("adds pages as the rows grow, rather than writing off the bottom", async () => {
    const one = await render([["a", "b", "1.00"]]);
    const many = await render(
      Array.from({ length: 200 }, (_, index) => [`row ${index}`, "Om Sagar Traders", "1.00"]),
    );

    const pagesIn = (bytes: Buffer) => (bytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pagesIn(one)).toBe(1);
    expect(pagesIn(many)).toBeGreaterThan(1);
  });

  it("renders an empty report rather than throwing on no rows", async () => {
    const bytes = await render([], ["Total", "", "0.00"]);
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("does not fall over when a row has fewer cells than there are columns", async () => {
    const bytes = await render([["only one cell"]]);
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});

describe("toRenderable", () => {
  /**
   * Four site group names in the live database end with a carriage return. HTML
   * collapses that to nothing, which is why it has never been visible on a
   * screen; in a PDF cell it is a line break in the middle of a table row.
   */
  it("strips the carriage returns the live data actually contains", () => {
    expect(toRenderable("COMMUNITY HALL\r")).toBe("COMMUNITY HALL");
    expect(toRenderable("A\tB\nC")).toBe("A B C");
  });

  /**
   * The trap this whole module documents: pdfkit's standard fonts are WinAnsi,
   * the rupee sign is not in it, and `widthOfString` returns 0 rather than
   * failing — so an unmapped character VANISHES and the file still looks
   * plausible. A visible marker is a bug report; a silent gap is a wrong number
   * nobody questions.
   */
  it("marks characters the standard font cannot draw instead of dropping them", () => {
    expect(toRenderable("₹ 1,23,456.78")).toBe("? 1,23,456.78");
    expect(toRenderable("गुजरात")).toBe("??????");
  });

  it("keeps the Latin-1 and punctuation the encoding does cover", () => {
    expect(toRenderable("Café — “quoted”")).toBe("Café — “quoted”");
  });

  it("collapses runs of whitespace and trims, so a cell cannot start with a gap", () => {
    expect(toRenderable("  Om   Sagar  ")).toBe("Om Sagar");
  });
});
