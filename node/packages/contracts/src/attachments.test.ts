import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_TYPES,
  attachmentExtension,
  attachmentRejection,
  formatBytes,
  isAllowedAttachment,
} from "./attachments";
import { uuidId } from "./fields";
import { createInwardChallanSchema } from "./inward-challans";
import { createPurchaseRequestSchema } from "./purchase-requests";

describe("the attachment allowlist", () => {
  /**
   * All three script in a browser. `.svg` is the one that looks like an image
   * and is not — served inline it is a stored XSS on this application's own
   * origin, with the viewer's session attached.
   */
  it("excludes every format that can execute in a browser", () => {
    for (const extension of [".html", ".htm", ".svg", ".xml", ".js", ".exe", ".sh", ".php"]) {
      expect(ATTACHMENT_TYPES).not.toHaveProperty(extension);
      expect(isAllowedAttachment(`file${extension}`)).toBe(false);
    }
  });

  it("includes what a site office actually attaches to a challan", () => {
    for (const name of ["slip.pdf", "photo.jpg", "scan.PNG", "ledger.xlsx", "notes.txt"]) {
      expect(isAllowedAttachment(name)).toBe(true);
    }
  });

  describe("attachmentExtension", () => {
    const cases: [string, string][] = [
      ["a.pdf", ".pdf"],
      ["A.PDF", ".pdf"],
      ["archive.tar.gz", ".gz"],
      // A double extension is only ever the last one.
      ["shell.php.pdf", ".pdf"],
      ["noextension", ""],
      [".hidden", ""],
      ["trailing.", ""],
      ["x.waytoolongext", ""],
    ];

    for (const [input, expected] of cases) {
      it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
        expect(attachmentExtension(input)).toBe(expected);
      });
    }
  });

  describe("attachmentRejection", () => {
    it("accepts an ordinary file", () => {
      expect(attachmentRejection({ name: "slip.pdf", size: 1024 })).toBeNull();
    });

    it("names the limit rather than just refusing", () => {
      expect(attachmentRejection({ name: "big.pdf", size: ATTACHMENT_MAX_BYTES + 1 })).toContain(
        "The limit is 10.0 MB",
      );
    });

    it("accepts a file exactly on the limit", () => {
      expect(attachmentRejection({ name: "edge.pdf", size: ATTACHMENT_MAX_BYTES })).toBeNull();
    });

    it("refuses an empty file, which is almost always a failed copy", () => {
      expect(attachmentRejection({ name: "slip.pdf", size: 0 })).toContain("is empty");
    });

    it("says what IS allowed when the type is not", () => {
      const reason = attachmentRejection({ name: "page.html", size: 10 });
      expect(reason).toContain(".html");
      expect(reason).toContain(".pdf");
    });

    it("has something useful to say about a file with no extension", () => {
      expect(attachmentRejection({ name: "scan", size: 10 })).toContain("no file extension");
    });
  });

  describe("formatBytes", () => {
    const cases: [number, string][] = [
      [0, "0 B"],
      [512, "512 B"],
      [1024, "1 KB"],
      [245_760, "240 KB"],
      [ATTACHMENT_MAX_BYTES, "10.0 MB"],
    ];

    for (const [bytes, expected] of cases) {
      it(`${bytes} -> ${expected}`, () => {
        expect(formatBytes(bytes)).toBe(expected);
      });
    }
  });
});

/**
 * REGRESSION. An unselected `<select>` submits the empty string.
 *
 * `uuidId.nullable().optional()` rejected that as "Not a valid identifier", so
 * an inward challan with no supplier could not be saved at all — on a screen
 * where no supplier is the COMMON case, because the source's live create path
 * (`AddItemInWordDetails`) never writes one. The purchase request form had the
 * same defect on its optional item.
 *
 * Both now use `optionalUuidId`, which maps "" to null BEFORE the uuid check —
 * so "nothing chosen" and "chosen and invalid" remain different answers.
 */
describe("an optional id from a select that was left blank", () => {
  const challan = {
    siteId: "11111111-1111-1111-1111-111111111111",
    itemId: "22222222-2222-2222-2222-222222222222",
    unitId: 1,
    quantity: "4000.00",
  };

  it("accepts an inward challan with no supplier chosen", () => {
    const parsed = createInwardChallanSchema.parse({ ...challan, supplierId: "" });
    expect(parsed.supplierId).toBeNull();
  });

  it("accepts one where the field is absent or explicitly null", () => {
    expect(createInwardChallanSchema.parse(challan).supplierId).toBeNull();
    expect(createInwardChallanSchema.parse({ ...challan, supplierId: null }).supplierId).toBeNull();
  });

  it("still refuses a supplier id that is present and malformed", () => {
    expect(() => createInwardChallanSchema.parse({ ...challan, supplierId: "42" })).toThrow(
      /Not a valid identifier/,
    );
  });

  it("accepts a purchase request for an item that is not in the master", () => {
    const parsed = createPurchaseRequestSchema.parse({
      siteId: "11111111-1111-1111-1111-111111111111",
      itemId: "",
      itemName: "GSB, 20mm",
      unitId: 1,
      quantity: "10.00",
    });
    expect(parsed.itemId).toBeNull();
  });
});

/**
 * REGRESSION. A required select that was never touched.
 *
 * `uuidId` was `z.string().uuid("Not a valid identifier")`, so leaving the
 * supplier dropdown alone on the purchase order form and pressing Save put
 * "Not a valid identifier" under it — a message about the shape of a value,
 * on a field whose only problem was that it was empty. Reported from a
 * screenshot of the form. The blank and the malformed cases now say different
 * things, and this pins both.
 */
describe("a required id from a select that was left blank", () => {
  it("asks for a choice rather than complaining about the value", () => {
    const result = uuidId.safeParse("");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]!.message).toBe("Choose one");
  });

  it("still calls a present-but-malformed id what it is", () => {
    const result = uuidId.safeParse("42");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]!.message).toBe("Not a valid identifier");
  });

  it("accepts a real one", () => {
    expect(uuidId.parse("11111111-1111-1111-1111-111111111111")).toBe(
      "11111111-1111-1111-1111-111111111111",
    );
  });
});
