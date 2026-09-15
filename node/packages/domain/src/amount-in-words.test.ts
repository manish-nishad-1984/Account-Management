import { describe, expect, it } from "vitest";
import { amountInWords, wholeNumberInWords } from "./amount-in-words.js";

describe("wholeNumberInWords", () => {
  it.each([
    [0n, "Zero"],
    [7n, "Seven"],
    [19n, "Nineteen"],
    [20n, "Twenty"],
    [45n, "Forty Five"],
    [100n, "One Hundred"],
    [205n, "Two Hundred Five"],
    [1_000n, "One Thousand"],
    [99_999n, "Ninety Nine Thousand Nine Hundred Ninety Nine"],
    [1_00_000n, "One Lakh"],
    [12_34_567n, "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven"],
    [1_00_00_000n, "One Crore"],
    [3_59_54_445n, "Three Crore Fifty Nine Lakh Fifty Four Thousand Four Hundred Forty Five"],
    [125_00_00_000n, "One Hundred Twenty Five Crore"],
  ])("%s is %s", (value, words) => {
    expect(wholeNumberInWords(value)).toBe(words);
  });

  /** The source's version printed "Two Hundred  Five", with two spaces. */
  it("never puts two spaces together", () => {
    for (const value of [205n, 1_005n, 10_00_005n, 1_00_00_001n]) {
      expect(wholeNumberInWords(value)).not.toMatch(/ {2}/);
    }
  });
});

describe("amountInWords", () => {
  it("writes rupees, then paise, the way the old invoice did", () => {
    expect(amountInWords("123456.78")).toBe(
      "INR One Lakh Twenty Three Thousand Four Hundred Fifty Six and Seventy Eight Paise Only",
    );
  });

  it("leaves paise out when there are none", () => {
    expect(amountInWords("5900.00")).toBe("INR Five Thousand Nine Hundred Only");
  });

  it("rounds to the paisa rather than dropping the third decimal", () => {
    expect(amountInWords("10.005")).toBe("INR Ten and One Paise Only");
  });

  it("says zero for nothing", () => {
    expect(amountInWords("0")).toBe("INR Zero Only");
  });

  it("says minus for a negative amount", () => {
    expect(amountInWords("-250.50")).toBe("INR Minus Two Hundred Fifty and Fifty Paise Only");
  });
});
