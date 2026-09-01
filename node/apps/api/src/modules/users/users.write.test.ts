import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createUserSchema } from "@accountmanagement/contracts";
import { UsersRepository } from "./users.repository";
import { UserPermissionsRepository } from "./user-permissions.repository";
import { PasswordService } from "../auth/password.service";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";

const input = (overrides: Record<string, unknown> = {}) =>
  createUserSchema.parse({
    userName: "newperson",
    firstName: "New",
    lastName: "Person",
    email: "new@example.com",
    phoneNo: "9825011111",
    password: "Correct-Horse-9",
    ...overrides,
  });

describe("UsersRepository — writes (real PostgreSQL)", () => {
  let db: Database;
  let repo: UsersRepository;
  let passwords: PasswordService;
  let siteId: string;
  let companyId: string;

  beforeEach(async () => {
    db = await freshDatabase();
    passwords = new PasswordService();
    repo = new UsersRepository(db, passwords);

    const [company] = await db
      .insert(schema.companies)
      .values({ name: "Test Company" })
      .returning({ id: schema.companies.id });
    companyId = company!.id;

    const [site] = await db
      .insert(schema.sites)
      .values({ name: "Test Site" })
      .returning({ id: schema.sites.id });
    siteId = site!.id;
  });

  /**
   * The single most important assertion in this file. The .NET system stores
   * passwords in plaintext and compares them with `!=` (assessment C-1); a port
   * that regressed to that would still pass every behavioural test.
   */
  it("stores an argon2id hash, never the password itself", async () => {
    const created = await repo.create(input(), ACTOR);

    const [stored] = await db
      .select({ password: schema.users.password, isLegacy: schema.users.passwordIsLegacy })
      .from(schema.users)
      .where(eq(schema.users.id, created.id));

    expect(stored!.password).not.toBe("Correct-Horse-9");
    expect(stored!.password.startsWith("$argon2")).toBe(true);
    expect(await passwords.verify(stored!.password, "Correct-Horse-9")).toEqual({
      ok: true,
      needsRehash: false,
    });
  });

  /**
   * A user created here has never had a plaintext credential, so it must not be
   * counted against the C-1 migration backlog that
   * `select count(*) from users where password_is_legacy` reports.
   */
  it("does not mark a newly created user as a legacy-password row", async () => {
    const created = await repo.create(input(), ACTOR);
    const detail = await repo.findById(created.id);
    expect(detail.passwordIsLegacy).toBe(false);
  });

  it("never returns the password on any read path", async () => {
    const created = await repo.create(input(), ACTOR);

    expect(created).not.toHaveProperty("password");
    expect(await repo.findById(created.id)).not.toHaveProperty("password");

    const page = await repo.list({ limit: 25, sortDir: "asc" });
    expect(page.rows[0]).not.toHaveProperty("password");
  });

  it("creates the user and both sets of assignments together", async () => {
    const created = await repo.create(input({ siteIds: [siteId], companyIds: [companyId] }), ACTOR);

    expect(created.siteIds).toEqual([siteId]);
    expect(created.companyIds).toEqual([companyId]);
  });

  /**
   * `BeginTransaction` has zero matches in the 10,304 lines of the .NET
   * repository layer. This asserts the port does better: a failure while writing
   * assignments must leave no user behind either.
   */
  it("rolls the user back when an assignment fails", async () => {
    await expect(
      repo.create(
        input({ siteIds: ["99999999-9999-9999-9999-999999999999"] }),
        ACTOR,
      ),
    ).rejects.toBeDefined();

    expect(await repo.total()).toBe(0);
  });

  it("refuses a username that differs from an existing one only by case", async () => {
    await repo.create(input({ userName: "manish" }), ACTOR);

    await expect(
      repo.create(input({ userName: "Manish", email: "other@example.com" }), ACTOR),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("leaves the password alone when an update does not carry one", async () => {
    const created = await repo.create(input(), ACTOR);
    const [before] = await db
      .select({ password: schema.users.password })
      .from(schema.users)
      .where(eq(schema.users.id, created.id));

    await repo.update(created.id, { firstName: "Renamed" }, ACTOR);

    const [after] = await db
      .select({ password: schema.users.password })
      .from(schema.users)
      .where(eq(schema.users.id, created.id));

    expect(after!.password).toBe(before!.password);
  });

  it("re-hashes and clears the legacy flag when an administrator sets a password", async () => {
    // A user the ETL carried across with a plaintext password.
    const [legacy] = await db
      .insert(schema.users)
      .values({
        firstName: "Legacy",
        lastName: "User",
        email: "legacy@example.com",
        phoneNo: "9825022222",
        userName: "legacyuser",
        password: "plaintext-from-sql-server",
        passwordIsLegacy: true,
      })
      .returning({ id: schema.users.id });

    await repo.update(legacy!.id, { password: "Correct-Horse-9" }, ACTOR);

    const [stored] = await db
      .select({
        password: schema.users.password,
        isLegacy: schema.users.passwordIsLegacy,
        migratedAt: schema.users.passwordMigratedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, legacy!.id));

    expect(stored!.password.startsWith("$argon2")).toBe(true);
    expect(stored!.isLegacy).toBe(false);
    expect(stored!.migratedAt).toBeInstanceOf(Date);
  });

  it("distinguishes 'assignments not sent' from 'assignments cleared'", async () => {
    const created = await repo.create(input({ siteIds: [siteId] }), ACTOR);

    // Not sent — must survive.
    const untouched = await repo.update(created.id, { firstName: "Renamed" }, ACTOR);
    expect(untouched.siteIds).toEqual([siteId]);

    // Sent as empty — must clear.
    const cleared = await repo.update(created.id, { siteIds: [] }, ACTOR);
    expect(cleared.siteIds).toEqual([]);
  });

  it("de-duplicates repeated ids rather than failing on the composite key", async () => {
    const created = await repo.create(input({ siteIds: [siteId, siteId] }), ACTOR);
    expect(created.siteIds).toEqual([siteId]);
  });

  it("refuses to delete the caller's own account", async () => {
    const created = await repo.create(input(), ACTOR);

    await expect(repo.remove(created.id, created.id)).rejects.toMatchObject({ status: 400 });
  });

  /**
   * A soft delete fires no cascade, so without an explicit revoke the deleted
   * user's refresh token stays valid and can be exchanged for a fresh access
   * token — the account keeps working for as long as the token lives.
   */
  it("revokes refresh tokens when a user is deleted", async () => {
    const created = await repo.create(input(), ACTOR);

    await db.insert(schema.refreshTokens).values({
      tokenHash: "hash-of-a-token",
      userId: created.id,
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    await repo.remove(created.id, ACTOR);

    const [token] = await db
      .select({ revokedAt: schema.refreshTokens.revokedAt })
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.userId, created.id));

    expect(token!.revokedAt).toBeInstanceOf(Date);
  });

  it("deactivates as well as soft-deleting, so nothing treats the row as live", async () => {
    const created = await repo.create(input(), ACTOR);
    await repo.remove(created.id, ACTOR);

    const [stored] = await db
      .select({ isDeleted: schema.users.isDeleted, isActive: schema.users.isActive })
      .from(schema.users)
      .where(eq(schema.users.id, created.id));

    expect(stored!.isDeleted).toBe(true);
    expect(stored!.isActive).toBe(false);
  });

  it("offers only live sites and companies as assignment options", async () => {
    await db.insert(schema.sites).values({ name: "Deleted Site", isDeleted: true });
    const options = await repo.assignmentOptions();

    expect(options.sites.map((site) => site.name)).toEqual(["Test Site"]);
    expect(options.companies.map((company) => company.name)).toEqual(["Test Company"]);
  });
});

describe("UserPermissionsRepository (real PostgreSQL)", () => {
  let db: Database;
  let repo: UserPermissionsRepository;
  let userId: string;

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new UserPermissionsRepository(db);

    await db.insert(schema.forms).values([
      { id: 1, formName: "User", formGroup: "Masters", orderId: 1, isActive: true },
      { id: 7, formName: "Supplier", formGroup: "Masters", orderId: 2, isActive: true },
      { id: 9, formName: "Retired Screen", formGroup: "Masters", orderId: 3, isActive: false },
    ]);

    const [user] = await db
      .insert(schema.users)
      .values({
        firstName: "A",
        lastName: "B",
        email: "a@b.com",
        phoneNo: "9825033333",
        userName: "matrixuser",
        password: "hash",
      })
      .returning({ id: schema.users.id });
    userId = user!.id;
  });

  /**
   * A left join, not an inner one: a form the user has no row for must still
   * appear unticked, or the screen can only ever remove rights, never add them.
   */
  it("lists every active form even where the user has no permission row", async () => {
    const matrix = await repo.findForUser(userId);

    expect(matrix.rows.map((row) => row.formName)).toEqual(["User", "Supplier"]);
    expect(matrix.rows.every((row) => row.isViewAllow === false)).toBe(true);
  });

  it("excludes inactive forms, which grant nothing at login either", async () => {
    const matrix = await repo.findForUser(userId);
    expect(matrix.rows.map((row) => row.formName)).not.toContain("Retired Screen");
  });

  it("reports the permission subject each form produces", async () => {
    const matrix = await repo.findForUser(userId);
    expect(matrix.rows.find((row) => row.formName === "Supplier")!.subject).toBe("supplier");
  });

  it("saves a grant and reads it back", async () => {
    const saved = await repo.replaceForUser(
      userId,
      [
        {
          formId: 7,
          isViewAllow: true,
          isAddAllow: true,
          isEditAllow: false,
          isDeleteAllow: false,
          isApproved: false,
        },
      ],
      ACTOR,
    );

    const supplier = saved.rows.find((row) => row.formId === 7)!;
    expect(supplier.isViewAllow).toBe(true);
    expect(supplier.isAddAllow).toBe(true);
    expect(supplier.isEditAllow).toBe(false);
  });

  /**
   * A right without View is unreachable — the screen it applies to cannot be
   * opened — so it is either a mistake or a false record of what someone can do.
   */
  it("refuses a right granted without View", async () => {
    await expect(
      repo.replaceForUser(
        userId,
        [
          {
            formId: 7,
            isViewAllow: false,
            isAddAllow: false,
            isEditAllow: true,
            isDeleteAllow: false,
            isApproved: false,
          },
        ],
        ACTOR,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("stores no row at all for a form granted nothing", async () => {
    await repo.replaceForUser(
      userId,
      [
        {
          formId: 7,
          isViewAllow: false,
          isAddAllow: false,
          isEditAllow: false,
          isDeleteAllow: false,
          isApproved: false,
        },
      ],
      ACTOR,
    );

    const rows = await db
      .select({ formId: schema.userFormPermissions.formId })
      .from(schema.userFormPermissions)
      .where(eq(schema.userFormPermissions.userId, userId));

    // The table says what a user HAS, not what they were considered for.
    expect(rows).toHaveLength(0);
  });

  it("replaces the whole matrix rather than merging into it", async () => {
    const grant = (formId: number) => ({
      formId,
      isViewAllow: true,
      isAddAllow: false,
      isEditAllow: false,
      isDeleteAllow: false,
      isApproved: false,
    });

    await repo.replaceForUser(userId, [grant(1), grant(7)], ACTOR);
    const after = await repo.replaceForUser(userId, [grant(7)], ACTOR);

    expect(after.rows.find((row) => row.formId === 1)!.isViewAllow).toBe(false);
    expect(after.rows.find((row) => row.formId === 7)!.isViewAllow).toBe(true);
  });

  it("404s for a user that does not exist", async () => {
    await expect(
      repo.findForUser("99999999-9999-9999-9999-999999999999"),
    ).rejects.toMatchObject({ status: 404 });
  });
});
