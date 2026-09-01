import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createCompanySchema } from "@accountmanagement/contracts";
import { CompaniesRepository } from "./companies.repository";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";

/** Parses through the real contract, so the tests exercise the coercions too. */
const input = (overrides: Record<string, unknown> = {}) =>
  createCompanySchema.parse({ name: "Test Company", ...overrides });

describe("CompaniesRepository — writes (real PostgreSQL)", () => {
  let db: Database;
  let repo: CompaniesRepository;

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new CompaniesRepository(db);
  });

  it("creates a company and stamps the caller as created_by", async () => {
    const created = await repo.create(input(), ACTOR);

    const [stored] = await db
      .select({ createdBy: schema.companies.createdBy, updatedAt: schema.companies.updatedAt })
      .from(schema.companies)
      .where(eq(schema.companies.id, created.id));

    expect(created.name).toBe("Test Company");
    expect(stored!.createdBy).toBe(ACTOR);
    // updated_at stays null until something updates it — a create is not an update.
    expect(stored!.updatedAt).toBeNull();
  });

  it("upper-cases GST, PAN and IFSC so display matches the unique index", async () => {
    const created = await repo.create(
      input({ gstNo: "24aaacd1234a1z5", panNo: "aaacd1234a", ifscCode: "hdfc0001234" }),
      ACTOR,
    );

    expect(created.gstNo).toBe("24AAACD1234A1Z5");
    expect(created.panNo).toBe("AAACD1234A");
    expect(created.ifscCode).toBe("HDFC0001234");
  });

  it("refuses a second company with the same GST number, whatever the case", async () => {
    await repo.create(input({ gstNo: "24AAACD1234A1Z5" }), ACTOR);

    await expect(
      repo.create(input({ name: "Other Company", gstNo: "24aaacd1234a1z5" }), ACTOR),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("allows many companies with no GST number, because the index is partial", async () => {
    await repo.create(input({ name: "No GST One" }), ACTOR);
    await repo.create(input({ name: "No GST Two" }), ACTOR);

    expect(await repo.total()).toBe(2);
  });

  /**
   * The bank details are the reason the list and detail projections differ, so
   * this asserts the difference rather than trusting it stays.
   */
  it("keeps bank account number and IFSC out of the list payload", async () => {
    await repo.create(input({ accountNo: "50100000000001", ifscCode: "HDFC0001234" }), ACTOR);

    const page = await repo.list({ limit: 25, sortDir: "asc" });
    const row = page.rows[0]!;

    expect(row).not.toHaveProperty("accountNo");
    expect(row).not.toHaveProperty("ifscCode");
    expect(row.bankName).toBeDefined();
  });

  it("returns the bank details on the detail payload", async () => {
    const created = await repo.create(input({ accountNo: "50100000000001" }), ACTOR);
    const detail = await repo.findById(created.id);

    expect(detail.accountNo).toBe("50100000000001");
  });

  it("updates only the fields supplied, leaving the rest alone", async () => {
    const created = await repo.create(
      input({ accountNo: "50100000000001", bankName: "HDFC Bank" }),
      ACTOR,
    );

    const updated = await repo.update(created.id, { name: "Renamed Company" }, ACTOR);

    expect(updated.name).toBe("Renamed Company");
    // The account number was never sent, so it must survive the update.
    expect(updated.accountNo).toBe("50100000000001");
    expect(updated.bankName).toBe("HDFC Bank");
  });

  it("stamps updated_by and updated_at on an update", async () => {
    const created = await repo.create(input(), ACTOR);
    await repo.update(created.id, { name: "Renamed" }, ACTOR);

    const [stored] = await db
      .select({ updatedBy: schema.companies.updatedBy, updatedAt: schema.companies.updatedAt })
      .from(schema.companies)
      .where(eq(schema.companies.id, created.id));

    expect(stored!.updatedBy).toBe(ACTOR);
    expect(stored!.updatedAt).toBeInstanceOf(Date);
  });

  it("soft-deletes rather than removing the row", async () => {
    const created = await repo.create(input(), ACTOR);
    await repo.remove(created.id, ACTOR);

    const [stored] = await db
      .select({ isDeleted: schema.companies.isDeleted })
      .from(schema.companies)
      .where(eq(schema.companies.id, created.id));

    expect(stored!.isDeleted).toBe(true);
    expect(await repo.total()).toBe(0);
  });

  it("treats a soft-deleted company as gone for read, update and delete alike", async () => {
    const created = await repo.create(input(), ACTOR);
    await repo.remove(created.id, ACTOR);

    await expect(repo.findById(created.id)).rejects.toMatchObject({ status: 404 });
    await expect(repo.update(created.id, { name: "Zombie" }, ACTOR)).rejects.toMatchObject({
      status: 404,
    });
    await expect(repo.remove(created.id, ACTOR)).rejects.toMatchObject({ status: 404 });
  });

  /**
   * The junction row has `on delete cascade`, but a SOFT delete never fires it.
   * Without this guard the assignment survives, pointing at a company no screen
   * can show, and the user's token keeps carrying the id.
   */
  it("refuses to delete a company that still has users assigned", async () => {
    const created = await repo.create(input(), ACTOR);

    const [user] = await db
      .insert(schema.users)
      .values({
        firstName: "A",
        lastName: "B",
        email: "a@b.com",
        phoneNo: "9000000000",
        userName: "assigned",
        password: "hash",
      })
      .returning({ id: schema.users.id });

    await db
      .insert(schema.userCompanies)
      .values({ userId: user!.id, companyId: created.id });

    await expect(repo.remove(created.id, ACTOR)).rejects.toMatchObject({ status: 409 });

    // And it really is still there, not half-deleted.
    expect(await repo.total()).toBe(1);
  });

  it("frees the company for deletion once the assignment is removed", async () => {
    const created = await repo.create(input(), ACTOR);
    const [user] = await db
      .insert(schema.users)
      .values({
        firstName: "A",
        lastName: "B",
        email: "a@b.com",
        phoneNo: "9000000000",
        userName: "assigned",
        password: "hash",
      })
      .returning({ id: schema.users.id });

    await db.insert(schema.userCompanies).values({ userId: user!.id, companyId: created.id });
    await db.delete(schema.userCompanies).where(eq(schema.userCompanies.companyId, created.id));

    await expect(repo.remove(created.id, ACTOR)).resolves.toBeUndefined();
  });
});
