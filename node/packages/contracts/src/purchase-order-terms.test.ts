import { describe, expect, it } from "vitest";
import {
  LEGACY_TERMS_TEMPLATE_IDS,
  TERMS_ALLOWED_ATTRIBUTES,
  TERMS_ALLOWED_SCHEMES,
  TERMS_ALLOWED_TAGS,
  TERMS_MAX_LENGTH,
  TERMS_TEMPLATES,
  TERMS_TEMPLATE_KEYS,
} from "./purchase-order-terms";
import { createPurchaseOrderSchema } from "./purchase-orders";

const LINE = {
  itemId: "",
  itemName: "Cement",
  unitId: 1,
  quantity: "10",
  unitPrice: "100.00",
  gstPercent: "18",
};

const ORDER = {
  siteId: "8f1a0f2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f",
  supplierId: "1f1a0f2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f",
  companyId: "2f1a0f2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f",
  items: [LINE],
};

describe("the three templates", () => {
  it("has one per legacy tab, in order", () => {
    expect(TERMS_TEMPLATES.map((template) => template.key)).toEqual([...TERMS_TEMPLATE_KEYS]);
    expect(TERMS_TEMPLATES.map((template) => template.label)).toEqual([
      "Template 1",
      "Template 2",
      "Template 3",
    ]);
  });

  /**
   * The clause counts are what the Razor view holds: 8, 7 and 7, each under a
   * "Terms & Condition" heading line. If a template is ever edited, this is the
   * test that says so out loud rather than letting a clause quietly vanish.
   */
  it("carries the clause counts the source view carries", () => {
    const clauses = TERMS_TEMPLATES.map(
      (template) => (template.html.match(/<p>\d+\./g) ?? []).length,
    );
    expect(clauses).toEqual([8, 7, 7]);
  });

  it("escapes the ampersands rather than leaving bare ones", () => {
    // "Terms & Condition" and "Freight & Annexure" are in every template. A bare
    // `&` is not valid HTML and a sanitiser is entitled to do anything with it.
    for (const template of TERMS_TEMPLATES) {
      expect(template.html).not.toMatch(/&(?!amp;|lt;|gt;|quot;|#)/);
    }
  });

  it("uses only tags that are on the allowlist", () => {
    for (const template of TERMS_TEMPLATES) {
      for (const [, tag] of template.html.matchAll(/<\/?([a-z0-9]+)/g)) {
        expect(TERMS_ALLOWED_TAGS).toContain(tag);
      }
    }
  });

  it("fits the stored length several times over", () => {
    for (const template of TERMS_TEMPLATES) {
      expect(template.html.length).toBeLessThan(TERMS_MAX_LENGTH / 5);
    }
  });
});

describe("the legacy template ids", () => {
  it("maps every value the source can store", () => {
    expect(LEGACY_TERMS_TEMPLATE_IDS).toEqual({
      "Term-1": "template-1",
      "Term-2": "template-2",
      "Term-3": "template-3",
    });
  });

  it("maps to keys the contract accepts", () => {
    for (const key of Object.values(LEGACY_TERMS_TEMPLATE_IDS)) {
      expect(TERMS_TEMPLATE_KEYS).toContain(key);
    }
  });
});

describe("the allowlist", () => {
  it("excludes everything that can execute or fetch", () => {
    for (const tag of ["script", "iframe", "object", "embed", "img", "style", "form", "input"]) {
      expect(TERMS_ALLOWED_TAGS).not.toContain(tag);
    }
  });

  it("allows no attribute that carries code or styling", () => {
    const attributes = Object.values(TERMS_ALLOWED_ATTRIBUTES).flat();
    for (const attribute of ["style", "class", "id", "onclick", "onerror", "srcset"]) {
      expect(attributes).not.toContain(attribute);
    }
  });

  it("permits no scheme a link could execute in", () => {
    for (const scheme of ["javascript", "data", "vbscript", "file"]) {
      expect(TERMS_ALLOWED_SCHEMES).not.toContain(scheme);
    }
  });
});

describe("terms on the create contract", () => {
  it("accepts a template's own html", () => {
    for (const template of TERMS_TEMPLATES) {
      const parsed = createPurchaseOrderSchema.parse({
        ...ORDER,
        terms: template.html,
        termsTemplate: template.key,
      });
      expect(parsed.terms).toBe(template.html);
      expect(parsed.termsTemplate).toBe(template.key);
    }
  });

  it("defaults the template to null, for terms typed from scratch", () => {
    const parsed = createPurchaseOrderSchema.parse({ ...ORDER, terms: "<p>Ours</p>" });
    expect(parsed.termsTemplate).toBeNull();
  });

  it("refuses a template key that is not one of the three", () => {
    const result = createPurchaseOrderSchema.safeParse({ ...ORDER, termsTemplate: "template-9" });
    expect(result.success).toBe(false);
  });

  it("refuses terms longer than the column takes", () => {
    const result = createPurchaseOrderSchema.safeParse({
      ...ORDER,
      terms: `<p>${"x".repeat(TERMS_MAX_LENGTH)}</p>`,
    });
    expect(result.success).toBe(false);
  });

  /**
   * The schema deliberately does NOT strip markup — the server does, because a
   * refinement runs in the browser too and anything a caller can skip by posting
   * directly is not a security control. This test pins that division so nobody
   * "fixes" it by adding a transform here and assuming the API is covered.
   */
  it("does not itself strip anything, by design", () => {
    const parsed = createPurchaseOrderSchema.parse({
      ...ORDER,
      terms: "<p>ok</p><script>alert(1)</script>",
    });
    expect(parsed.terms).toContain("<script>");
  });
});
