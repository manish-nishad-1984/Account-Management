import { describe, expect, it } from "vitest";
import { todayInput } from "./dates";

describe("todayInput", () => {
  it("formats as the date input wants it", () => {
    expect(todayInput(new Date(2026, 8, 14, 10, 0, 0))).toBe("2026-09-14");
  });

  it("pads a single-digit month and day", () => {
    expect(todayInput(new Date(2026, 0, 5, 10, 0, 0))).toBe("2026-01-05");
  });

  /**
   * THE ONE THAT MATTERS. `toISOString().slice(0, 10)` is the obvious
   * implementation and it is wrong east of Greenwich: it converts to UTC first,
   * so in India (UTC+5:30) every document created after 18:30 would be dated
   * yesterday — and on the 1st of a month, in the wrong month.
   */
  it("still says today at half past eleven at night", () => {
    expect(todayInput(new Date(2026, 8, 14, 23, 30, 0))).toBe("2026-09-14");
  });

  it("reads the LOCAL calendar day, whatever the clock says in London", () => {
    const evening = new Date(2026, 8, 14, 23, 30, 0);
    expect(todayInput(evening)).toBe(
      [
        evening.getFullYear(),
        String(evening.getMonth() + 1).padStart(2, "0"),
        String(evening.getDate()).padStart(2, "0"),
      ].join("-"),
    );
  });

  it("reads the clock each time it is called", () => {
    expect(todayInput()).toBe(todayInput(new Date()));
  });
});
