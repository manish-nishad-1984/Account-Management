import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgeBadge, ageInDays, ageLabel, ageTone } from "./AgeBadge";

describe("ageInDays", () => {
  it("counts whole days from the bill's date to today", () => {
    expect(ageInDays("2026-10-17", "2026-10-17")).toBe(0);
    expect(ageInDays("2026-10-16", "2026-10-17")).toBe(1);
    expect(ageInDays("2026-09-17T00:00:00.000Z", "2026-10-17")).toBe(30);
    // A month end, and across a year end.
    expect(ageInDays("2026-02-28", "2026-03-01")).toBe(1);
    expect(ageInDays("2025-12-31", "2026-01-02")).toBe(2);
  });

  it("is never negative, and null without a date", () => {
    expect(ageInDays("2026-10-20", "2026-10-17")).toBe(0);
    expect(ageInDays(null)).toBeNull();
    expect(ageInDays("not a date", "2026-10-17")).toBeNull();
  });
});

describe("the badge", () => {
  it("deepens in colour with age: green, amber, orange, red", () => {
    expect([0, 30, 31, 60, 61, 90, 91, 400].map(ageTone)).toEqual(["green", "green", "amber", "amber", "orange", "orange", "red", "red"]);
  });

  it("says Today, 1 day, or n days", () => {
    expect([0, 1, 45].map(ageLabel)).toEqual(["Today", "1 day", "45 days"]);
  });

  it("shows nothing for a bill with no date", () => {
    const { container } = render(<AgeBadge documentDate={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the age of a bill", () => {
    const old = new Date();
    old.setDate(old.getDate() - 100);
    const day = `${old.getFullYear()}-${String(old.getMonth() + 1).padStart(2, "0")}-${String(old.getDate()).padStart(2, "0")}`;
    render(<AgeBadge documentDate={day} />);
    expect(screen.getByText("100 days")).toHaveClass("bg-red-100");
  });
});
