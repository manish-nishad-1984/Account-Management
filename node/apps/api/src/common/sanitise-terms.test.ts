import { describe, expect, it } from "vitest";
import { TERMS_TEMPLATES } from "@accountmanagement/contracts";
import { sanitiseTerms } from "./sanitise-terms";

/**
 * The security boundary of the terms editor.
 *
 * The legacy print view renders this column with `@Html.Raw`, so anything that
 * survives sanitising executes for every reader of that purchase order. These
 * are the tests that matter most in this feature; the editor above them is a
 * convenience and this is the control.
 */

describe("what must not survive", () => {
  const attacks: [name: string, html: string][] = [
    ["a script element", "<p>Terms</p><script>fetch('//evil')</script>"],
    ["an inline handler", `<p onclick="steal()">Terms</p>`],
    ["an error handler on a broken image", `<img src=x onerror="steal()">`],
    ["a javascript: link", `<a href="javascript:steal()">Click</a>`],
    ["a javascript: link with padding", `<a href="  JaVaScRiPt:steal()">Click</a>`],
    ["a data: link", `<a href="data:text/html;base64,PHNjcmlwdD4=">Click</a>`],
    ["an iframe", `<iframe src="//evil"></iframe>`],
    ["an object", `<object data="//evil"></object>`],
    ["an embed", `<embed src="//evil">`],
    ["a form that posts elsewhere", `<form action="//evil"><input name="x"></form>`],
    ["a style element", "<style>body{display:none}</style><p>Terms</p>"],
    ["an inline style", `<p style="position:fixed;inset:0">Terms</p>`],
    ["a base tag", `<base href="//evil/">`],
    ["an svg with a handler", `<svg><a onclick="steal()"><text>x</text></a></svg>`],
    ["a meta refresh", `<meta http-equiv="refresh" content="0;url=//evil">`],
    ["an unclosed script", "<p>Terms</p><script>steal()"],
    ["a link element", `<link rel="stylesheet" href="//evil">`],
  ];

  for (const [name, html] of attacks) {
    it(`removes ${name}`, () => {
      const clean = sanitiseTerms(html) ?? "";
      expect(clean).not.toMatch(/<script|<iframe|<object|<embed|<style|<form|<svg|<base|<link/i);
      expect(clean).not.toMatch(/on[a-z]+\s*=/i);
      expect(clean).not.toMatch(/javascript:/i);
      expect(clean).not.toMatch(/\bdata:/i);
      // The payload's own text goes too, not merely its ability to run.
      expect(clean).not.toContain("steal()");
      expect(clean).not.toContain("evil");
    });
  }

  /**
   * `<scr<script>ipt>` is the payload that defeats a REGEX sanitiser: strip the
   * inner `<script>` as a pattern and the outer fragments close up into a live
   * `<script>` tag that was never there before. It is the reason this file uses
   * a parser and not a pattern.
   *
   * What a parser does instead is worth pinning exactly, because it is not
   * "nothing survives". The inner element is dropped with its contents, and the
   * fragments around it are left as ESCAPED TEXT — inert, and visible. So the
   * order's terms can end up with a few characters of nonsense in them, which is
   * a legibility problem and not a security one. Stated here so that the day
   * somebody sees `ipt&gt;` in a document, the answer is already written down.
   */
  it("renders the regex-defeating payload as inert text, not as a live tag", () => {
    const clean = sanitiseTerms("<p>Terms</p><scr<script>ipt>steal()</script>") ?? "";

    expect(clean).not.toMatch(/<script/i);
    expect(clean).toContain("&gt;");
    expect(clean).not.toContain("<scr");
  });

  /**
   * The default behaviour of `sanitize-html` KEEPS the text inside a removed
   * tag, so a script's body would appear as visible prose in the middle of a
   * purchase order's terms. `nonTextTags` is what stops that, and this is the
   * test that fails if the option is ever dropped.
   */
  it("drops the CONTENTS of a script, not just its tags", () => {
    expect(sanitiseTerms("<p>Terms</p><script>alert(1)</script>")).toBe("<p>Terms</p>");
  });

  it("keeps the prose around a removed element", () => {
    // Removing the attack must not take the document with it. A sanitiser that
    // blanks the field on any bad input is one users route around.
    const clean = sanitiseTerms("<p>Before</p><script>x</script><p>After</p>");
    expect(clean).toBe("<p>Before</p><p>After</p>");
  });
});

describe("what must survive", () => {
  it("keeps every tag on the allowlist", () => {
    const html =
      "<h2>Terms</h2><p><strong>Bold</strong> and <em>italic</em> and <u>underline</u> and <s>struck</s></p>" +
      "<ul><li>One</li></ul><ol><li>Two</li></ol><blockquote><p>Quoted</p></blockquote>";
    expect(sanitiseTerms(html)).toBe(html);
  });

  it("keeps a table, because the legacy toolbar has one and rate tables exist", () => {
    const html =
      "<table><thead><tr><th>Item</th><th>Rate</th></tr></thead>" +
      "<tbody><tr><td>Cement</td><td>350.00</td></tr></tbody></table>";
    expect(sanitiseTerms(html)).toBe(html);
  });

  it("keeps colspan and rowspan, which a table needs to mean anything", () => {
    const html = `<table><tbody><tr><td colspan="2">Total</td></tr></tbody></table>`;
    expect(sanitiseTerms(html)).toContain(`colspan="2"`);
  });

  it("keeps http, https and mailto links", () => {
    for (const href of ["https://example.com/t", "http://example.com/t", "mailto:a@b.com"]) {
      expect(sanitiseTerms(`<a href="${href}">Link</a>`)).toContain(href);
    }
  });

  it("refuses a protocol-relative link, which means nothing on a printed order", () => {
    const clean = sanitiseTerms(`<p>See <a href="//example.com/t">the annexure</a></p>`) ?? "";
    expect(clean).toContain("the annexure");
    expect(clean).not.toContain("example.com");
  });

  it("keeps the link text when the scheme is refused", () => {
    // Losing the href is right; losing the sentence it was in is not.
    const clean = sanitiseTerms(`<p>See <a href="javascript:x()">the annexure</a></p>`);
    expect(clean).toContain("the annexure");
    expect(clean).not.toContain("javascript");
  });

  it("passes all three templates through unchanged", () => {
    // If a template ever fails to round-trip, the editor would silently rewrite
    // the boilerplate the moment somebody opened and saved an order.
    for (const template of TERMS_TEMPLATES) {
      expect(sanitiseTerms(template.html)).toBe(template.html);
    }
  });

  it("is idempotent, so saving twice cannot keep changing the document", () => {
    const once = sanitiseTerms("<p>A</p><script>x</script><b>B</b>");
    expect(sanitiseTerms(once)).toBe(once);
  });
});

describe("normalising", () => {
  it("stores b and i as strong and em, so the column holds one spelling", () => {
    expect(sanitiseTerms("<b>Bold</b> <i>Italic</i>")).toBe("<strong>Bold</strong> <em>Italic</em>");
  });

  it("turns a div into a paragraph", () => {
    // Browsers produce divs in `contenteditable` depending on how a line was
    // created. Two spellings of "a block of text" is two cases for every reader.
    expect(sanitiseTerms("<div>Line</div>")).toBe("<p>Line</p>");
  });
});

describe("emptiness", () => {
  it("is null for null and undefined", () => {
    expect(sanitiseTerms(null)).toBeNull();
    expect(sanitiseTerms(undefined)).toBeNull();
  });

  it("is null for an empty string", () => {
    expect(sanitiseTerms("")).toBeNull();
    expect(sanitiseTerms("   ")).toBeNull();
  });

  /**
   * What `contenteditable` leaves behind when a person selects everything and
   * presses delete. Stored as-is it would print a blank line and read back as a
   * non-null value, so "no terms" and "an empty document" would stop being
   * distinguishable — and only one of the two is a thing a user meant.
   */
  it("is null for what an emptied editor leaves behind", () => {
    for (const empty of ["<p></p>", "<p><br></p>", "<p>&nbsp;</p>", "<ul><li></li></ul>", "<br>"]) {
      expect(sanitiseTerms(empty)).toBeNull();
    }
  });

  it("is null when everything in it was disallowed", () => {
    expect(sanitiseTerms("<script>alert(1)</script>")).toBeNull();
  });

  it("keeps a document whose only content is inside a table cell", () => {
    // The emptiness check looks at text, not at tags, and a table's content is
    // real content even though the outer elements carry none.
    expect(sanitiseTerms("<table><tbody><tr><td>Rate</td></tr></tbody></table>")).not.toBeNull();
  });
});
