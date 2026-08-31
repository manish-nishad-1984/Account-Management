import { UnauthorizedException } from "@nestjs/common";
import { beforeEach, describe, expect, it } from "vitest";
import { AuthService } from "./auth.service";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";
import { InMemoryUserRepository, type AuthUser } from "./user.repository";
import { loadEnv } from "../../config/env";

const BASE_USER: AuthUser = {
  id: "user-1",
  userName: "manish",
  isActive: true,
  password: "Admin123", // legacy plaintext, exactly as the User table holds it today
  permissions: ["invoice.view"],
  siteIds: ["site-a"],
  companyIds: ["company-a"],
};

describe("AuthService", () => {
  let users: InMemoryUserRepository;
  let passwords: PasswordService;
  let tokens: TokenService;
  let service: AuthService;

  beforeEach(async () => {
    const pem = await TokenService.generatePemPair();
    users = new InMemoryUserRepository();
    passwords = new PasswordService();
    tokens = new TokenService(
      loadEnv({
        NODE_ENV: "test",
        JWT_PRIVATE_KEY: pem.privateKey,
        JWT_PUBLIC_KEY: pem.publicKey,
      } as NodeJS.ProcessEnv),
    );
    service = new AuthService(users, passwords, tokens);
  });

  describe("login", () => {
    it("issues tokens for correct credentials", async () => {
      users.seed(BASE_USER);
      const result = await service.login("manish", "Admin123");

      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
      expect(result.user).toEqual({
        id: "user-1",
        userName: "manish",
        permissions: ["invoice.view"],
      });
    });

    it("NEVER returns a credential in the login response (finding C-2)", async () => {
      users.seed(BASE_USER);
      const result = await service.login("manish", "Admin123");
      expect(JSON.stringify(result)).not.toContain("Admin123");
      expect(result.user).not.toHaveProperty("password");
    });

    it("rejects a wrong password", async () => {
      users.seed(BASE_USER);
      await expect(service.login("manish", "wrong")).rejects.toThrow(UnauthorizedException);
    });

    it("rejects an unknown user with the SAME message as a wrong password", async () => {
      users.seed(BASE_USER);
      const wrongPassword = await service.login("manish", "wrong").catch((e) => e.message);
      const unknownUser = await service.login("nobody", "whatever").catch((e) => e.message);
      expect(unknownUser).toBe(wrongPassword);
    });

    it("rejects an inactive user without revealing that the password was right", async () => {
      users.seed({ ...BASE_USER, isActive: false });
      const inactive = await service.login("manish", "Admin123").catch((e) => e.message);
      expect(inactive).toBe("Invalid username or password");
    });

    it("matches the username case-insensitively", async () => {
      users.seed(BASE_USER);
      await expect(service.login("MANISH", "Admin123")).resolves.toBeTruthy();
    });
  });

  describe("legacy plaintext migration (finding C-1)", () => {
    it("upgrades the stored password to argon2id on first successful login", async () => {
      users.seed(BASE_USER);
      expect(passwords.isHashed((await users.findById("user-1"))!.password)).toBe(false);

      await service.login("manish", "Admin123");

      const after = await users.findById("user-1");
      expect(passwords.isHashed(after!.password)).toBe(true);
      expect(after!.password).not.toBe("Admin123");
    });

    it("the same password still works after the upgrade", async () => {
      users.seed(BASE_USER);
      await service.login("manish", "Admin123");
      await expect(service.login("manish", "Admin123")).resolves.toBeTruthy();
    });

    it("does not re-hash a password that is already hashed", async () => {
      const hashed = await passwords.hash("Admin123");
      users.seed({ ...BASE_USER, password: hashed });

      await service.login("manish", "Admin123");

      expect((await users.findById("user-1"))!.password).toBe(hashed);
    });

    it("does not upgrade on a failed login", async () => {
      users.seed(BASE_USER);
      await service.login("manish", "wrong").catch(() => undefined);
      expect((await users.findById("user-1"))!.password).toBe("Admin123");
    });
  });

  describe("refresh", () => {
    it("exchanges a valid refresh token for a new pair", async () => {
      users.seed(BASE_USER);
      const first = await service.login("manish", "Admin123");
      const second = await service.refresh(first.refreshToken);

      expect(second.refreshToken).not.toBe(first.refreshToken);
      expect(second.user.id).toBe("user-1");
    });

    it("ROTATES: the presented refresh token cannot be replayed", async () => {
      users.seed(BASE_USER);
      const first = await service.login("manish", "Admin123");
      await service.refresh(first.refreshToken);

      await expect(service.refresh(first.refreshToken)).rejects.toThrow(UnauthorizedException);
    });

    it("rejects an unknown refresh token", async () => {
      await expect(service.refresh("never-issued")).rejects.toThrow(UnauthorizedException);
    });

    it("rejects a refresh token after logout", async () => {
      users.seed(BASE_USER);
      const session = await service.login("manish", "Admin123");
      await service.logout(session.refreshToken);

      await expect(service.refresh(session.refreshToken)).rejects.toThrow(UnauthorizedException);
    });

    it("rejects a refresh token whose user has been deactivated", async () => {
      users.seed(BASE_USER);
      const session = await service.login("manish", "Admin123");
      users.seed({ ...BASE_USER, password: "irrelevant", isActive: false });

      await expect(service.refresh(session.refreshToken)).rejects.toThrow(UnauthorizedException);
    });
  });
});
