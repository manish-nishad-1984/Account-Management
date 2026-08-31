import { describe, expect, it } from "vitest";
import { PasswordService } from "./password.service";

describe("PasswordService", () => {
  const service = new PasswordService();

  it("produces an argon2id hash", async () => {
    const hashed = await service.hash("correct horse battery staple");
    expect(hashed.startsWith("$argon2id$")).toBe(true);
    expect(service.isHashed(hashed)).toBe(true);
  });

  it("produces a different hash each time (salted)", async () => {
    const a = await service.hash("same-password");
    const b = await service.hash("same-password");
    expect(a).not.toBe(b);
  });

  it("verifies a correct password against a hash", async () => {
    const hashed = await service.hash("s3cret");
    expect(await service.verify(hashed, "s3cret")).toEqual({ ok: true, needsRehash: false });
  });

  it("rejects an incorrect password against a hash", async () => {
    const hashed = await service.hash("s3cret");
    expect(await service.verify(hashed, "wrong")).toEqual({ ok: false, needsRehash: false });
  });

  it("rejects rather than throws on a malformed stored hash", async () => {
    const result = await service.verify("$argon2id$garbage", "anything");
    expect(result.ok).toBe(false);
  });

  describe("legacy plaintext rows (assessment finding C-1)", () => {
    it("accepts a correct legacy password and flags it for rehashing", async () => {
      // This is literally what is in the User table today.
      expect(await service.verify("Admin123", "Admin123")).toEqual({
        ok: true,
        needsRehash: true,
      });
    });

    it("rejects an incorrect legacy password", async () => {
      expect(await service.verify("Admin123", "admin123")).toEqual({
        ok: false,
        needsRehash: true,
      });
    });

    it("rejects a legacy password of different length without throwing", async () => {
      expect((await service.verify("Admin123", "x")).ok).toBe(false);
    });

    it("does not treat a legacy value as hashed", () => {
      expect(service.isHashed("Admin123")).toBe(false);
    });
  });
});
