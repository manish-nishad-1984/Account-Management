import { describe, expect, it } from "vitest";
import { phoneNumbers } from "./fields";

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
