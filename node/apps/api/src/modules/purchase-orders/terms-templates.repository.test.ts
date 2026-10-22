import { beforeEach, describe, expect, it } from "vitest";
import { createPurchaseOrderSchema, saveTermsTemplateSchema } from "@accountmanagement/contracts";
import { TermsTemplatesRepository } from "./terms-templates.repository";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "00000000-0000-4000-8000-000000000001";

/** Terms saved by name, to load into an order (client, 22 Oct 2026). */
describe("TermsTemplatesRepository (real PostgreSQL)", () => {
  let db: Database;
  let repo: TermsTemplatesRepository;
  const input = (name: string, html = "<p>1. Delivery in 7 days</p>") => saveTermsTemplateSchema.parse({ name, html });

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new TermsTemplatesRepository(db);
  });

  it("saves terms under a name and lists them by name", async () => {
    await repo.create(input("Steel supply"), ACTOR);
    await repo.create(input("  Cement   supply "), ACTOR);
    const rows = await repo.list();
    expect(rows.map((row) => row.name)).toEqual(["Cement supply", "Steel supply"]);
    expect(rows[1]!.html).toBe("<p>1. Delivery in 7 days</p>");
    expect(rows[1]!.updatedAt).not.toBeNull();
  });

  it("refuses a second template of the same name, whatever its case", async () => {
    await repo.create(input("Steel supply"), ACTOR);
    await expect(repo.create(input("STEEL SUPPLY"), ACTOR)).rejects.toMatchObject({ status: 409 });
  });

  it("strips what an order's terms may not hold, and refuses terms with nothing left", async () => {
    const saved = await repo.create(input("Safe", '<p onclick="x()">Pay in 30 days</p><script>alert(1)</script>'), ACTOR);
    expect(saved.html).toBe("<p>Pay in 30 days</p>");
    await expect(repo.create(input("Empty", "<p><br></p>"), ACTOR)).rejects.toMatchObject({ status: 400 });
  });

  it("replaces a template's text, and deletes it", async () => {
    const saved = await repo.create(input("Steel supply"), ACTOR);
    const changed = await repo.update(saved.id, input("Steel supply", "<p>2. Freight extra</p>"), ACTOR);
    expect(changed.html).toBe("<p>2. Freight extra</p>");

    await repo.remove(saved.id);
    expect(await repo.list()).toEqual([]);
    await expect(repo.remove(saved.id)).rejects.toMatchObject({ status: 404 });
  });

  it("lets an order record a saved template's id as where its terms came from", () => {
    const order = (termsTemplate: string) =>
      createPurchaseOrderSchema.safeParse({ termsTemplate }).error?.issues.some((issue) => issue.path[0] === "termsTemplate") ?? false;
    expect(order("template-2")).toBe(false);
    expect(order("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1")).toBe(false);
    expect(order("Template 9")).toBe(true);
  });
});
