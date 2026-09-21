import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SummaryStrip } from "./SummaryStrip";

/**
 * Client request, 21 Sep 2026: a document's figures on one line, ending in the
 * one that matters.
 */
describe("SummaryStrip", () => {
  it("shows every figure with its label", () => {
    render(
      <SummaryStrip
        items={[
          { label: "Sub total", value: "19,276.00" },
          { label: "Total GST", value: "1,316.95" },
          { label: "Total amount", value: "20,580.00", strong: true },
        ]}
      />,
    );

    const expected: [label: string, value: string][] = [
      ["Sub total", "19,276.00"],
      ["Total GST", "1,316.95"],
      ["Total amount", "20,580.00"],
    ];
    for (const [label, value] of expected) {
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByText(value)).toBeInTheDocument();
    }
  });

  /** The total is the figure people are looking for; it is picked out and last. */
  it("sets the strong figure apart at the end of the strip", () => {
    render(
      <SummaryStrip
        items={[
          { label: "Sub total", value: "100.00" },
          { label: "Total amount", value: "118.00", strong: true },
        ]}
      />,
    );

    const total = screen.getByText("Total amount").parentElement!;
    const subtotal = screen.getByText("Sub total").parentElement!;
    expect(total.className).toContain("ml-auto");
    expect(subtotal.className).not.toContain("ml-auto");
    expect(subtotal.compareDocumentPosition(total) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
