import { describe, expect, it } from "vitest";
import { pageBreaks, pdfFileName } from "./pdf";

/**
 * The two decisions in a saved PDF that are not the libraries' own: where each
 * page is cut, and what the file is called. The photograph itself needs a real
 * browser and is checked in one.
 */
describe("where a PDF's pages are cut", () => {
  it("is one page when everything fits", () => {
    expect(pageBreaks([100, 200, 300], 300, 1000)).toEqual([300]);
  });

  it("cuts under the last row that fits, never through one", () => {
    // Rows end at 400, 900 and 1100; a page holds 1000.
    expect(pageBreaks([400, 900, 1100, 1500], 1500, 1000)).toEqual([900, 1500]);
  });

  it("cuts a row taller than a page where the page ends, because nothing better exists", () => {
    expect(pageBreaks([2500], 2500, 1000)).toEqual([1000, 2000, 2500]);
  });

  /** A row ending just under the previous cut would leave a page with one line on it. */
  it("does not leave a page nearly empty to find a row edge", () => {
    // After cutting at 900, the only edge before 1900 is 1050 — 15% into the next page.
    expect(pageBreaks([900, 1050, 2400], 2400, 1000)).toEqual([900, 1900, 2400]);
  });

  /** The first 60-line order saved put its one-line footer alone on page 3. */
  it("folds a last page of a line or two into the page before", () => {
    // Cut at 900 and 1900 would leave 1900-1950 — 5% of a page — on its own.
    expect(pageBreaks([900, 1900, 1950], 1950, 1000)).toEqual([900, 1950]);
  });

  it("keeps a last page that has real content on it", () => {
    expect(pageBreaks([900, 1900, 2100], 2100, 1000)).toEqual([900, 1900, 2100]);
  });

  it("pages a long document through every page, ending at its foot", () => {
    const rows = Array.from({ length: 60 }, (_, index) => (index + 1) * 90);
    const cuts = pageBreaks(rows, 5400, 1000);

    expect(cuts.at(-1)).toBe(5400);
    let top = 0;
    for (const cut of cuts) {
      expect(cut - top).toBeLessThanOrEqual(1000);
      expect(rows.includes(cut) || cut === 5400).toBe(true);
      top = cut;
    }
  });
});

describe("a saved PDF's file name", () => {
  it("names the document and its number, as a person would", () => {
    expect(pdfFileName({ title: "TAX INVOICE", number: "DHP26-27-0042" })).toBe("Tax Invoice DHP26-27-0042.pdf");
  });

  /** Every number here has slashes, which a file name would read as folders. */
  it("takes the slashes out of the number", () => {
    expect(pdfFileName({ title: "PURCHASE ORDER", number: "DHP/PO/26-27/0107" })).toBe(
      "Purchase Order DHP-PO-26-27-0107.pdf",
    );
  });

  it("keeps a credit note's own title", () => {
    expect(pdfFileName({ title: "CREDIT NOTE", number: "CN:7" })).toBe("Credit Note CN-7.pdf");
  });
});
