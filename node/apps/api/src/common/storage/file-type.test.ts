import { describe, expect, it } from "vitest";
import { decideContentType, detectType } from "./file-type";

/** Real leading bytes, so these are the signatures a browser would actually send. */
const PDF = Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "binary");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const GIF = Buffer.from("GIF89a\x00\x00", "binary");
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x20, 0x00, 0x00, 0x00]),
  Buffer.from("WEBPVP8 ", "ascii"),
]);
const WAV = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x20, 0x00, 0x00, 0x00]),
  Buffer.from("WAVEfmt ", "ascii"),
]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const EXE = Buffer.from("MZ\x90\x00\x03\x00\x00\x00", "binary");
const HTML = Buffer.from("<!doctype html><script>alert(document.cookie)</script>", "utf8");
const TEXT = Buffer.from("Site,Item,Quantity\nSURAT,GSB,4000\n", "utf8");

describe("detectType", () => {
  const cases: [string, Buffer, string | null][] = [
    ["a PDF", PDF, "application/pdf"],
    ["a PNG", PNG, "image/png"],
    ["a JPEG", JPEG, "image/jpeg"],
    ["a GIF", GIF, "image/gif"],
    ["a WebP", WEBP, "image/webp"],
    ["a zip (which is what .docx and .xlsx are)", ZIP, "application/zip"],
    ["an OLE compound file (.doc, .xls)", OLE, "application/x-ole-storage"],
    ["plain text, which has no signature", TEXT, null],
    ["HTML, which also has none", HTML, null],
  ];

  for (const [label, bytes, expected] of cases) {
    it(`recognises ${label}`, () => {
      expect(detectType(bytes)).toBe(expected);
    });
  }

  /** RIFF is WebP, WAV and AVI. Stopping at the first four bytes gets it wrong. */
  it("does not call a WAV a WebP", () => {
    expect(detectType(WAV)).toBeNull();
  });

  it("does not read past the end of a very short file", () => {
    expect(detectType(Buffer.from([0x25]))).toBeNull();
    expect(detectType(Buffer.alloc(0))).toBeNull();
  });
});

describe("decideContentType", () => {
  it("accepts a PDF named as one, and serves it as one", () => {
    expect(decideContentType("challan.pdf", PDF)).toEqual({
      accepted: true,
      contentType: "application/pdf",
    });
  });

  /**
   * The case that matters. `.html` is not on the allowlist, so renaming is the
   * obvious next move — and the contents give it away.
   */
  it("refuses HTML wearing a .pdf extension", () => {
    const verdict = decideContentType("invoice.pdf", HTML);
    expect(verdict.accepted).toBe(false);
    expect(verdict.accepted === false && verdict.reason).toMatch(/is not a PDF/);
  });

  it("refuses an executable however it is named", () => {
    const verdict = decideContentType("photo.png", EXE);
    expect(verdict.accepted).toBe(false);
    expect(verdict.accepted === false && verdict.reason).toContain("is a program");
  });

  it("refuses an extension that is not on the allowlist at all", () => {
    for (const name of ["page.html", "vector.svg", "notes.xml", "run.exe", "lib.js"]) {
      expect(decideContentType(name, TEXT).accepted).toBe(false);
    }
  });

  it("refuses a file with no extension", () => {
    expect(decideContentType("scan", PDF).accepted).toBe(false);
  });

  /**
   * A phone writing a JPEG into a file called `.png` happens constantly and is
   * harmless. Serve it as what it is rather than refusing an ordinary user's
   * ordinary file.
   */
  it("accepts one image format named as another, and serves the truth", () => {
    expect(decideContentType("weighbridge.png", JPEG)).toEqual({
      accepted: true,
      contentType: "image/jpeg",
    });
  });

  it("does not extend that latitude across kinds", () => {
    // A zip called .pdf is not a naming slip.
    expect(decideContentType("invoice.pdf", ZIP).accepted).toBe(false);
    // Nor is a PDF called .xlsx.
    expect(decideContentType("book.xlsx", PDF).accepted).toBe(false);
  });

  it("takes a zip at its extension's word for .docx and .xlsx", () => {
    // The signature cannot tell them apart, and both are allowed, so the
    // extension decides which of the two it is served as.
    expect(decideContentType("book.xlsx", ZIP)).toEqual({
      accepted: true,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    expect(decideContentType("letter.docx", ZIP)).toEqual({
      accepted: true,
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  });

  it("accepts a modern .xls, which is often really a zip", () => {
    expect(decideContentType("ledger.xls", ZIP).accepted).toBe(true);
    expect(decideContentType("ledger.xls", OLE).accepted).toBe(true);
  });

  /** Text has no signature, so requiring one would refuse every genuine CSV. */
  it("accepts text and CSV without demanding a signature", () => {
    expect(decideContentType("items.csv", TEXT)).toEqual({
      accepted: true,
      contentType: "text/csv",
    });
    expect(decideContentType("notes.txt", TEXT).accepted).toBe(true);
  });

  /**
   * HTML in a .txt IS accepted, and that is fine: the download endpoint sends
   * `text/plain`, `nosniff` and `attachment`, so it cannot render. This test
   * exists to record that the decision is deliberate rather than an oversight.
   */
  it("accepts HTML inside a .txt, which the download headers render inert", () => {
    expect(decideContentType("notes.txt", HTML)).toEqual({
      accepted: true,
      contentType: "text/plain",
    });
  });
});
