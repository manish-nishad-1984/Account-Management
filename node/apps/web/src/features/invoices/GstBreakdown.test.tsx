import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GstBreakdown } from "./GstBreakdown";

/**
 * THE GST SPLIT ON THE FORM (client request, 17 Sep 2026).
 *
 * The rule the business gave: always half and half, CGST and SGST, never IGST.
 * 18% shows as CGST 9% + SGST 9%.
 */
const rowFor = (label: RegExp) => screen.getByText(label).closest("tr")!;

describe("the GST split under the totals", () => {
  it("halves each rate into CGST and SGST", () => {
    render(
      <GstBreakdown
        lines={[{ gstPercent: "18.00", netAmount: "1000.00", gstAmount: "180.00" }]}
      />,
    );

    const row = rowFor(/CGST 9% \+ SGST 9%/);
    expect(within(row).getByText("1,000.00")).toBeInTheDocument();
    // 180 split evenly.
    expect(within(row).getAllByText("90.00")).toHaveLength(2);
    expect(within(row).getByText("180.00")).toBeInTheDocument();
  });

  /**
   * THE HALVES MUST ADD UP TO THE TAX ON THE DOCUMENT. An odd paisa cannot be
   * halved, so the central half rounds down and the state half takes the
   * remainder. Halving each independently is what lets a printed invoice
   * disagree with itself by a paisa.
   */
  it("gives the odd paisa to one half, so the two always add to the GST", () => {
    render(
      <GstBreakdown lines={[{ gstPercent: "18.00", netAmount: "100.05", gstAmount: "18.01" }]} />,
    );

    const row = rowFor(/CGST 9% \+ SGST 9%/);
    expect(within(row).getByText("9.00")).toBeInTheDocument();
    expect(within(row).getByText("9.01")).toBeInTheDocument();
    expect(within(row).getByText("18.01")).toBeInTheDocument();
  });

  it("groups several lines that share a rate, and separates different rates", () => {
    render(
      <GstBreakdown
        lines={[
          { gstPercent: "18.00", netAmount: "1000.00", gstAmount: "180.00" },
          { gstPercent: "18.00", netAmount: "500.00", gstAmount: "90.00" },
          { gstPercent: "5.00", netAmount: "200.00", gstAmount: "10.00" },
        ]}
      />,
    );

    expect(within(rowFor(/CGST 9% \+ SGST 9%/)).getByText("1,500.00")).toBeInTheDocument();
    expect(within(rowFor(/CGST 2.5% \+ SGST 2.5%/)).getByText("200.00")).toBeInTheDocument();
    // The "All rates" line appears only when there is more than one rate.
    expect(within(rowFor(/All rates/)).getByText("280.00")).toBeInTheDocument();
  });

  it("shows no all-rates line when there is only one rate", () => {
    render(
      <GstBreakdown lines={[{ gstPercent: "18.00", netAmount: "1000.00", gstAmount: "180.00" }]} />,
    );
    expect(screen.queryByText(/All rates/)).not.toBeInTheDocument();
  });

  /** A document with nothing taxable shows nothing, not an empty table. */
  it("renders nothing when no line carries GST", () => {
    const { container } = render(
      <GstBreakdown
        lines={[
          { gstPercent: null, netAmount: "1000.00", gstAmount: "0.00" },
          { gstPercent: "0", netAmount: "500.00", gstAmount: "0.00" },
        ]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an empty document", () => {
    const { container } = render(<GstBreakdown lines={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
