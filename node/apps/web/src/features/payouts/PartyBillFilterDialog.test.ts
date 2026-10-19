import { describe, expect, it } from "vitest";
import { presetRange } from "./PartyBillFilterDialog";

describe("presetRange", () => {
  it("gives the quick date ranges in local dates", () => {
    expect(presetRange("30", "2026-10-19")).toEqual({ from: "2026-09-19", to: "2026-10-19" });
    expect(presetRange("month", "2026-10-19")).toEqual({ from: "2026-10-01", to: "2026-10-19" });
    expect(presetRange("lastMonth", "2026-03-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(presetRange("lastMonth", "2026-01-05")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(presetRange("all", "2026-10-19")).toEqual({ from: "", to: "" });
  });

  it("runs the financial year from 1 April to 31 March", () => {
    expect(presetRange("fy", "2026-10-19")).toEqual({ from: "2026-04-01", to: "2027-03-31" });
    expect(presetRange("fy", "2026-04-01")).toEqual({ from: "2026-04-01", to: "2027-03-31" });
    expect(presetRange("fy", "2026-03-31")).toEqual({ from: "2025-04-01", to: "2026-03-31" });
  });
});
