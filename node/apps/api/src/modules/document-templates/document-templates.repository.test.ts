import { ConflictException, BadRequestException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it } from "vitest";
import { presetLayout, type DocumentType } from "@accountmanagement/contracts";
import { DocumentTemplatesRepository, type TemplateInput } from "./document-templates.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

/**
 * DOCUMENT TEMPLATES — mostly about the default, because the default is what
 * decides how every invoice prints. There must be at most one per document type
 * per company, it must move in one step, and it must not disappear by accident.
 */

const ACTOR = "00000000-0000-0000-0000-0000000000aa";
const CAN = { canEdit: true, canDelete: true, canApprove: false };

describe("DocumentTemplatesRepository (real PostgreSQL)", () => {
  let db: Database;
  let repo: DocumentTemplatesRepository;
  let companyId: string;
  let otherCompanyId: string;

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new DocumentTemplatesRepository(db);
    const rows = await db
      .insert(schema.companies)
      .values([{ name: "DH PATEL" }, { name: "DEMO" }])
      .returning({ id: schema.companies.id, name: schema.companies.name });
    companyId = rows.find((row) => row.name === "DH PATEL")!.id;
    otherCompanyId = rows.find((row) => row.name === "DEMO")!.id;
  });

  const input = (overrides: Partial<TemplateInput> = {}): TemplateInput => ({
    documentType: "sales-invoice",
    companyId: null,
    name: "Classic",
    basedOn: "classic",
    layout: presetLayout("classic", "sales-invoice"),
    ...overrides,
  });

  describe("create", () => {
    it("stores the layout whole and gives it back", async () => {
      const created = await repo.create(input({ companyId }), ACTOR, CAN);

      expect(created).toMatchObject({ name: "Classic", companyId, companyName: "DH PATEL", basedOn: "classic" });
      expect(created.layout).toEqual(presetLayout("classic", "sales-invoice"));
    });

    it("is never the default when it is made", async () => {
      const created = await repo.create(input(), ACTOR, CAN);
      expect(created.isDefault).toBe(false);
    });

    it("refuses a company that does not exist", async () => {
      await expect(
        repo.create(input({ companyId: "00000000-0000-0000-0000-000000000123" }), ACTOR, CAN),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("list", () => {
    it("lists one document type only, defaults first", async () => {
      await repo.create(input({ name: "B" }), ACTOR, CAN);
      const a = await repo.create(input({ name: "Z default" }), ACTOR, CAN);
      await repo.create(input({ name: "Purchase", documentType: "purchase-invoice" }), ACTOR, CAN);
      await repo.makeDefault(a.id, ACTOR, CAN);

      const rows = await repo.list("sales-invoice", CAN);
      expect(rows.map((row) => row.name)).toEqual(["Z default", "B"]);
    });

    it("leaves deleted templates out", async () => {
      const gone = await repo.create(input({ name: "Gone" }), ACTOR, CAN);
      await repo.remove(gone.id, ACTOR);

      expect(await repo.list("sales-invoice", CAN)).toEqual([]);
      await expect(repo.findById(gone.id, CAN)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("the default", () => {
    it("moves from one template to another in one step", async () => {
      const first = await repo.create(input({ name: "First" }), ACTOR, CAN);
      const second = await repo.create(input({ name: "Second" }), ACTOR, CAN);

      await repo.makeDefault(first.id, ACTOR, CAN);
      await repo.makeDefault(second.id, ACTOR, CAN);

      const rows = await repo.list("sales-invoice", CAN);
      expect(rows.filter((row) => row.isDefault).map((row) => row.name)).toEqual(["Second"]);
    });

    it("is kept separately for each company, and for every company", async () => {
      const shared = await repo.create(input({ name: "Shared" }), ACTOR, CAN);
      const own = await repo.create(input({ name: "Own", companyId }), ACTOR, CAN);
      const other = await repo.create(input({ name: "Other", companyId: otherCompanyId }), ACTOR, CAN);

      await repo.makeDefault(shared.id, ACTOR, CAN);
      await repo.makeDefault(own.id, ACTOR, CAN);
      await repo.makeDefault(other.id, ACTOR, CAN);

      const defaults = (await repo.list("sales-invoice", CAN)).filter((row) => row.isDefault);
      expect(defaults.map((row) => row.name).sort()).toEqual(["Other", "Own", "Shared"]);
    });

    it("is kept separately for each document type", async () => {
      const sales = await repo.create(input({ name: "Sales" }), ACTOR, CAN);
      const purchase = await repo.create(input({ name: "Purchase", documentType: "purchase-invoice" }), ACTOR, CAN);

      await repo.makeDefault(sales.id, ACTOR, CAN);
      await repo.makeDefault(purchase.id, ACTOR, CAN);

      expect((await repo.findById(sales.id, CAN)).isDefault).toBe(true);
      expect((await repo.findById(purchase.id, CAN)).isDefault).toBe(true);
    });

    /**
     * The index is the backstop for a race the transaction cannot see. Two
     * every-company defaults would otherwise be allowed, because a unique index
     * counts NULLs as different from each other.
     */
    it("cannot be held twice in one scope, even written directly", async () => {
      const layout = presetLayout("minimal", "sales-invoice");
      await db.insert(schema.documentTemplates).values({ documentType: "sales-invoice", name: "A", layout, isDefault: true });

      await expect(
        db.insert(schema.documentTemplates).values({ documentType: "sales-invoice", name: "B", layout, isDefault: true }),
      ).rejects.toThrow();
    });

    it("refuses to be deleted", async () => {
      const template = await repo.create(input(), ACTOR, CAN);
      await repo.makeDefault(template.id, ACTOR, CAN);

      await expect(repo.remove(template.id, ACTOR)).rejects.toBeInstanceOf(ConflictException);
    });

    it("refuses to move to another company", async () => {
      const template = await repo.create(input({ companyId }), ACTOR, CAN);
      await repo.makeDefault(template.id, ACTOR, CAN);

      await expect(
        repo.update(template.id, { companyId: otherCompanyId }, ACTOR, CAN),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("update", () => {
    it("changes only what it is given", async () => {
      const template = await repo.create(input({ companyId }), ACTOR, CAN);
      const renamed = await repo.update(template.id, { name: "Renamed" }, ACTOR, CAN);

      expect(renamed).toMatchObject({ name: "Renamed", companyId });
      expect(renamed.layout).toEqual(template.layout);
    });

    it("replaces the layout", async () => {
      const template = await repo.create(input(), ACTOR, CAN);
      const layout = presetLayout("modern", "sales-invoice");
      const updated = await repo.update(template.id, { layout }, ACTOR, CAN);

      expect(updated.layout).toEqual(layout);
    });

    it("can make a company's template an every-company one", async () => {
      const template = await repo.create(input({ companyId }), ACTOR, CAN);
      const updated = await repo.update(template.id, { companyId: null }, ACTOR, CAN);

      expect(updated.companyId).toBeNull();
    });
  });

  describe("duplicate", () => {
    it("copies the layout under a new name, and does not copy the default", async () => {
      const source = await repo.create(input({ companyId, layout: presetLayout("compact", "sales-invoice") }), ACTOR, CAN);
      await repo.makeDefault(source.id, ACTOR, CAN);

      const copy = await repo.duplicate(source.id, ACTOR, CAN);

      expect(copy).toMatchObject({ name: "Classic (copy)", companyId, isDefault: false });
      expect(copy.id).not.toBe(source.id);
      expect(copy.layout).toEqual(source.layout);
    });
  });

  describe("forPrinting", () => {
    const type: DocumentType = "sales-invoice";

    it("offers the company's own templates and the every-company ones, not another company's", async () => {
      await repo.create(input({ name: "Shared" }), ACTOR, CAN);
      await repo.create(input({ name: "Own", companyId }), ACTOR, CAN);
      await repo.create(input({ name: "Other", companyId: otherCompanyId }), ACTOR, CAN);

      const { templates } = await repo.forPrinting(type, companyId);
      expect(templates.map((t) => t.name)).toEqual(["Own", "Shared"]);
    });

    it("prints with the company's default before the every-company default", async () => {
      const shared = await repo.create(input({ name: "Shared" }), ACTOR, CAN);
      const own = await repo.create(input({ name: "Own", companyId }), ACTOR, CAN);
      await repo.makeDefault(shared.id, ACTOR, CAN);
      await repo.makeDefault(own.id, ACTOR, CAN);

      expect((await repo.forPrinting(type, companyId)).defaultTemplateId).toBe(own.id);
      expect((await repo.forPrinting(type, otherCompanyId)).defaultTemplateId).toBe(shared.id);
    });

    it("has no default when nothing is set, so the built-in Classic prints", async () => {
      await repo.create(input(), ACTOR, CAN);
      expect((await repo.forPrinting(type, companyId)).defaultTemplateId).toBeNull();
    });
  });
});
