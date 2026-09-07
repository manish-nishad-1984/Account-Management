import { describe, expect, it } from "vitest";
import { contentDisposition } from "./content-disposition";

describe("contentDisposition", () => {
  it("always says attachment, never inline", () => {
    expect(contentDisposition("challan.pdf")).toMatch(/^attachment;/);
  });

  it("sends the name in both forms", () => {
    expect(contentDisposition("challan.pdf")).toBe(
      `attachment; filename="challan.pdf"; filename*=UTF-8''challan.pdf`,
    );
  });

  /**
   * A quote would otherwise close the parameter early and everything after it
   * would be read as further parameters — a file name writing header syntax.
   */
  it("strips a quote that would end the parameter", () => {
    const header = contentDisposition(`a".pdf`);
    expect(header).toBe(`attachment; filename="a.pdf"; filename*=UTF-8''a.pdf`);
  });

  /**
   * RESPONSE SPLITTING. A CR or LF in a header value ends the header, and
   * everything after it becomes headers of its own — set by whoever named the
   * uploaded file.
   */
  it("strips CR and LF, which would end the header itself", () => {
    const header = contentDisposition("a\r\nSet-Cookie: admin=1\r\n\r\n<script>.pdf");
    expect(header).not.toContain("\r");
    expect(header).not.toContain("\n");
    expect(header).not.toContain("Set-Cookie: admin=1\r");
  });

  it("strips a backslash, which escapes in a quoted string", () => {
    expect(contentDisposition(`a\\".pdf`)).not.toContain("\\");
  });

  it("carries a non-ASCII name in the encoded parameter and a safe one in the plain", () => {
    const header = contentDisposition("प्रमाणपत्र.pdf");
    expect(header).toContain("filename*=UTF-8''");
    expect(header).toContain(encodeURIComponent("प्रमाणपत्र.pdf"));
    // The plain parameter is ASCII only, so an old client still gets something.
    const plain = /filename="([^"]*)"/.exec(header)?.[1] ?? "";
    // eslint-disable-next-line no-control-regex
    expect(plain).toMatch(/^[ -~]+$/);
    expect(plain).toContain(".pdf");
  });

  it("falls back rather than emitting an empty or dot-only name", () => {
    for (const name of ["", "   ", ".", "..", "\r\n"]) {
      expect(contentDisposition(name)).toContain(`filename="attachment"`);
    }
  });

  /**
   * A semicolon separates parameters. RFC 6266 permits one inside a quoted
   * string and a strict parser copes, but a lenient one splits on it — so the
   * plain parameter gives it up and the encoded one, which escapes it properly,
   * carries the real name.
   */
  it("leaves no semicolon loose in the header", () => {
    const header = contentDisposition("a;b.pdf");
    expect(header.split(";")).toHaveLength(3);
    expect(header).toContain(`filename="a_b.pdf"`);
    expect(header).toContain("a%3Bb.pdf");
  });
});
