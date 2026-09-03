import { beforeEach, describe, expect, it } from "vitest";
import { AuthService } from "./auth.service";
import { DrizzleUserRepository } from "./drizzle-user.repository";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";
import { loadEnv } from "../../config/env";
import * as schema from "../../db/schema";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

describe("DrizzleUserRepository (real PostgreSQL)", () => {
  let db: Database;
  let repo: DrizzleUserRepository;
  let service: AuthService;
  let passwords: PasswordService;

  const COMPANY = "11111111-1111-1111-1111-111111111111";
  const SITE = "22222222-2222-2222-2222-222222222222";
  const USER = "33333333-3333-3333-3333-333333333333";

  beforeEach(async () => {
    db = await freshDatabase();
    repo = new DrizzleUserRepository(db);
    passwords = new PasswordService();

    const pem = await TokenService.generatePemPair();
    const tokens = new TokenService(
      loadEnv({
        NODE_ENV: "test",
        JWT_PRIVATE_KEY: pem.privateKey,
        JWT_PUBLIC_KEY: pem.publicKey,
      } as NodeJS.ProcessEnv),
    );
    service = new AuthService(repo, passwords, tokens);

    await db.insert(schema.companies).values({ id: COMPANY, name: "D H Infra" });
    await db.insert(schema.sites).values({ id: SITE, name: "Site A", companyId: COMPANY });
    // Controllers here are deliberately NOT the same word as the form name, and
    // Site/Group deliberately SHARE one — that is what production looks like.
    await db.insert(schema.forms).values([
      { id: 1, formName: "Supplier Invoice", controller: "Invoice", isActive: true },
      { id: 2, formName: "Purchase Order", controller: "PurchaseOrder", isActive: true },
      { id: 3, formName: "Retired Screen", controller: "Retired", isActive: false },
      { id: 4, formName: "Site", controller: "SiteMaster", isActive: true },
      { id: 5, formName: "Group", controller: "SiteMaster", isActive: true },
      { id: 6, formName: "User List", controller: "User", isActive: true },
    ]);
    await db.insert(schema.users).values({
      id: USER,
      firstName: "Manish",
      lastName: "Dhaduk",
      email: "m@example.com",
      phoneNo: "0000000000",
      userName: "manish",
      password: "Admin123", // legacy plaintext, as the ETL will land it
      passwordIsLegacy: true,
    });
    await db.insert(schema.userSites).values({ userId: USER, siteId: SITE });
    await db.insert(schema.userCompanies).values({ userId: USER, companyId: COMPANY });
    await db.insert(schema.userFormPermissions).values([
      { userId: USER, formId: 1, isViewAllow: true, isEditAllow: true, isApproved: true },
      { userId: USER, formId: 2, isViewAllow: true },
      { userId: USER, formId: 3, isViewAllow: true },
      // Site: view only. Group: view AND delete. If the subject came from the
      // controller these would merge and Site would inherit delete.
      { userId: USER, formId: 4, isViewAllow: true },
      { userId: USER, formId: 5, isViewAllow: true, isDeleteAllow: true },
      { userId: USER, formId: 6, isViewAllow: true },
    ]);
  });

  it("loads a user with sites and companies as arrays, not CSV strings", async () => {
    const user = await repo.findByUserName("manish");
    expect(user).not.toBeNull();
    expect(user!.siteIds).toEqual([SITE]);
    expect(user!.companyIds).toEqual([COMPANY]);
  });

  it("derives permission strings from the per-form boolean columns", async () => {
    const user = await repo.findByUserName("manish");
    expect(user!.permissions).toEqual(
      expect.arrayContaining([
        "supplier-invoice.view",
        "supplier-invoice.edit",
        "supplier-invoice.approve",
        "purchase-order.view",
      ]),
    );
    expect(user!.permissions).not.toContain("supplier-invoice.add");
    expect(user!.permissions).not.toContain("supplier-invoice.delete");
  });

  it("derives the subject from the FORM NAME, not the controller", async () => {
    const user = await repo.findByUserName("manish");

    // `Web/Helper/FormPermission.cs:30` matches on `a.FormName.Contains(...)`,
    // and every [FormPermissionAttribute] string is a form name. Deriving from
    // the controller instead 403s every master screen against real data, where
    // Site's controller is "SiteMaster" and Item's is "ItemMaster".
    expect(user!.permissions).toContain("site.view");
    expect(user!.permissions).not.toContain("sitemaster.view");
  });

  it("keeps two forms that share a controller as separate subjects", async () => {
    const user = await repo.findByUserName("manish");

    // The regression that matters. In production `Site` and `Group` BOTH have
    // the controller "SiteMaster", so a controller-derived subject merged them:
    // Group's delete right silently became a delete right over Sites.
    expect(user!.permissions).toContain("group.delete");
    expect(user!.permissions).not.toContain("site.delete");
  });

  it("folds the several user forms onto one subject", async () => {
    const user = await repo.findByUserName("manish");

    // Form holds "User List", "User Permission" and "Userwise Permission",
    // all of which grant rights over users.
    expect(user!.permissions).toContain("user.view");
    expect(user!.permissions).not.toContain("user-list.view");
  });

  it("excludes permissions for inactive forms", async () => {
    const user = await repo.findByUserName("manish");
    expect(user!.permissions).not.toContain("retired.view");
  });

  it("matches the username case-insensitively", async () => {
    expect(await repo.findByUserName("MANISH")).not.toBeNull();
    expect(await repo.findByUserName("Manish")).not.toBeNull();
  });

  it("hides soft-deleted users", async () => {
    await db.update(schema.users).set({ isDeleted: true });
    expect(await repo.findByUserName("manish")).toBeNull();
  });

  describe("foreign keys are real (unlike the SQL Server schema)", () => {
    it("refuses a permission row for a user that does not exist", async () => {
      await expect(
        db.insert(schema.userFormPermissions).values({
          userId: "99999999-9999-9999-9999-999999999999",
          formId: 1,
        }),
      ).rejects.toThrow();
    });

    it("refuses a user_sites row for a site that does not exist", async () => {
      await expect(
        db.insert(schema.userSites).values({
          userId: USER,
          siteId: "99999999-9999-9999-9999-999999999999",
        }),
      ).rejects.toThrow();
    });

    it("refuses a second user whose name differs only by case", async () => {
      // Login matches case-insensitively, so 'Manish' and 'manish' must not be
      // able to coexist — otherwise two rows answer one login.
      await expect(
        db.insert(schema.users).values({
          firstName: "Other",
          lastName: "Person",
          email: "o@example.com",
          phoneNo: "1111111111",
          userName: "MANISH",
          password: "whatever",
        }),
      ).rejects.toThrow();
    });

    it("refuses a duplicate user_form_permissions row", async () => {
      await expect(
        db.insert(schema.userFormPermissions).values({ userId: USER, formId: 1 }),
      ).rejects.toThrow();
    });
  });

  describe("password migration, end to end against the database", () => {
    it("persists the argon2id hash and clears the legacy flag on first login", async () => {
      await service.login("manish", "Admin123");

      const [row] = await db.select().from(schema.users);
      expect(passwords.isHashed(row!.password)).toBe(true);
      expect(row!.passwordIsLegacy).toBe(false);
      expect(row!.passwordMigratedAt).not.toBeNull();
    });

    it("reports how many users still hold plaintext — the migration progress query", async () => {
      const before = await db.select().from(schema.users);
      expect(before.filter((u) => u.passwordIsLegacy)).toHaveLength(1);

      await service.login("manish", "Admin123");

      const after = await db.select().from(schema.users);
      expect(after.filter((u) => u.passwordIsLegacy)).toHaveLength(0);
    });

    it("logs in again with the same password after migration", async () => {
      await service.login("manish", "Admin123");
      await expect(service.login("manish", "Admin123")).resolves.toBeTruthy();
    });
  });

  describe("refresh tokens persist", () => {
    it("stores only the hash, and rotation survives a round trip", async () => {
      const session = await service.login("manish", "Admin123");

      const [stored] = await db.select().from(schema.refreshTokens);
      expect(stored!.tokenHash).not.toBe(session.refreshToken);
      expect(stored!.revokedAt).toBeNull();

      await service.refresh(session.refreshToken);
      await expect(service.refresh(session.refreshToken)).rejects.toThrow();
    });
  });
});
