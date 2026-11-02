import { describe, expect, it } from "vitest";
import { formatRate } from "./format";
import { money, optionalMoney, phoneNumbers, rate } from "./fields";

/**
 * THE PHONE FIELD MUST ACCEPT WHAT THE BUSINESS ALREADY HAS.
 *
 * The rule it replaced demanded exactly one Indian mobile, ten digits starting
 * 6-9, and the live database does not comply: sites carry several numbers in
 * this one field and supplier numbers run to twelve digits. Those rows could be
 * read but never saved again.
 *
 * These tests are therefore mostly about what is ALLOWED. The two that reject
 * are the whole remaining rule: there must be a digit, and there must be no
 * letters — which between them catch a field filled in by mistake and nothing
 * else.
 */

const accepts = (value: string) => phoneNumbers.safeParse(value).success;
const parse = (value: string) => phoneNumbers.parse(value);

describe("phoneNumbers", () => {
  describe("accepts", () => {
    it("a plain ten-digit mobile", () => {
      expect(accepts("9825012345")).toBe(true);
    });

    /** A real row from the live site list. */
    it("three numbers separated by commas", () => {
      expect(accepts("9624972802,7567501707,98982598555")).toBe(true);
    });

    it("a country code, which the old rule rejected", () => {
      expect(accepts("919825012345")).toBe(true);
      expect(accepts("+91 98250 12345")).toBe(true);
    });

    it("a landline with its STD code", () => {
      expect(accepts("0261-2345678")).toBe(true);
      expect(accepts("(0261) 234 5678")).toBe(true);
    });

    it("numbers separated by a slash, as a letterhead prints them", () => {
      expect(accepts("9825012345 / 9825067890")).toBe(true);
    });

    it("a number that starts with a digit the old rule refused", () => {
      expect(accepts("2612345678")).toBe(true);
    });

    it("nothing at all, where the field is optional", () => {
      expect(parse("")).toBeNull();
      expect(parse("   ")).toBeNull();
    });
  });

  describe("rejects", () => {
    it("a value with no digit in it", () => {
      expect(accepts("call the office")).toBe(false);
      expect(accepts("-")).toBe(false);
    });

    it("a name or an address typed into the phone box", () => {
      expect(accepts("Amit Patel 9825012345")).toBe(false);
      expect(accepts("Shop 4, MG Road 380001")).toBe(false);
    });

    it("more than a hundred characters, which is no longer a phone number", () => {
      expect(accepts("9825012345,".repeat(10))).toBe(false);
    });
  });

  /**
   * STORED AS TYPED. The previous rule stripped spaces, hyphens and a leading
   * `+91` before saving, so the field gave back something other than what was
   * put in it.
   */
  it("keeps the value exactly as it was written", () => {
    expect(parse("+91 98250-12345")).toBe("+91 98250-12345");
    expect(parse("  9825012345  ")).toBe("9825012345");
  });
});

// Client, 2 Nov 2026: "75.300" was refused as a price.
describe("money", () => {
  it("takes zeros past the paise and drops them", () => {
    expect(money("Price").parse("75.300")).toBe("75.30");
    expect(money("Price").parse("75.000")).toBe("75.00");
    expect(optionalMoney("GST amount").parse("13.550")).toBe("13.55");
  });

  it("still refuses a third place that is not a zero", () => {
    expect(money("Price").safeParse("75.325").success).toBe(false);
    expect(optionalMoney("GST amount").safeParse("13.554").success).toBe(false);
  });

  it("leaves an ordinary amount as it is", () => {
    expect(money("Price").parse("75.3")).toBe("75.3");
    expect(money("Price").parse("1200")).toBe("1200");
    expect(optionalMoney("GST amount").parse("")).toBeNull();
  });
});

// Client, 2 Nov 2026: steel is priced to three places, 75.325 a kilo.
describe("rate", () => {
  it("takes up to three decimal places", () => {
    expect(rate("Price").parse("75.325")).toBe("75.325");
    expect(rate("Price").parse("75.3")).toBe("75.3");
    expect(rate("Price").parse("75.3250")).toBe("75.325");
  });

  it("refuses a fourth place, a negative and a blank", () => {
    expect(rate("Price").safeParse("75.3251").success).toBe(false);
    expect(rate("Price").safeParse("-1").success).toBe(false);
    expect(rate("Price").safeParse("").success).toBe(false);
  });

  it("shows two places, and the third only when it is there", () => {
    expect(formatRate("75.325")).toBe("75.325");
    expect(formatRate("75.300")).toBe("75.30");
    expect(formatRate("75.3")).toBe("75.30");
    expect(formatRate("125000.5")).toBe("1,25,000.50");
    expect(formatRate("125000.125")).toBe("1,25,000.125");
  });
});
