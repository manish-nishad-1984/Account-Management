import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PartPaid, isPartPaid } from "./PartPaid";

describe("PartPaid", () => {
  it("is part paid only when something, but less than the bill, is pending", () => {
    expect(isPartPaid("47471.00", "9056.00")).toBe(true);
    expect(isPartPaid("47471.00", "47471.00")).toBe(false);
    expect(isPartPaid("47471.00", "0")).toBe(false);
    expect(isPartPaid(undefined, "9056.00")).toBe(false);
  });

  it("says so, and what of the bill has been paid", () => {
    render(<PartPaid billAmount="47471.00" pending="9056.00" />);
    expect(screen.getByText("Part paid")).toBeInTheDocument();
    expect(screen.getByText("38,415.00 paid of 47,471.00")).toBeInTheDocument();
  });

  it("shows nothing for a bill unpaid in full", () => {
    const { container } = render(<PartPaid billAmount="1416.00" pending="1416.00" />);
    expect(container).toBeEmptyDOMElement();
  });
});
