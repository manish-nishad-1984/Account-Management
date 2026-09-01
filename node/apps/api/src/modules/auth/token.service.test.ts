import { beforeAll, describe, expect, it } from "vitest";
import { TokenService } from "./token.service";
import { loadEnv, type Env } from "../../config/env";

describe("TokenService", () => {
  let service: TokenService;
  let env: Env;

  beforeAll(async () => {
    const pem = await TokenService.generatePemPair();
    env = loadEnv({
      NODE_ENV: "test",
      JWT_PRIVATE_KEY: pem.privateKey,
      JWT_PUBLIC_KEY: pem.publicKey,
      JWT_ISSUER: "test-issuer",
      JWT_AUDIENCE: "test-audience",
    } as NodeJS.ProcessEnv);
    service = new TokenService(env);
  });

  const claims = {
    sub: "11111111-1111-1111-1111-111111111111",
    permissions: ["invoice.view", "invoice.create"],
    siteIds: ["site-a", "site-b"],
    companyIds: ["company-a"],
  };

  it("issues a verifiable access token carrying identity and permissions", async () => {
    const issued = await service.issue(claims);
    const verified = await service.verifyAccessToken(issued.accessToken);

    expect(verified.sub).toBe(claims.sub);
    expect(verified.permissions).toEqual(claims.permissions);
    expect(verified.siteIds).toEqual(claims.siteIds);
    expect(verified.companyIds).toEqual(claims.companyIds);
    expect(verified.iss).toBe("test-issuer");
    expect(verified.aud).toBe("test-audience");
  });

  it("uses RS256, not a symmetric algorithm", async () => {
    const issued = await service.issue(claims);
    const header = JSON.parse(
      Buffer.from(issued.accessToken.split(".")[0]!, "base64url").toString("utf8"),
    );
    expect(header.alg).toBe("RS256");
  });

  it("rejects a token signed by a different key pair", async () => {
    const otherPem = await TokenService.generatePemPair();
    const other = new TokenService(
      loadEnv({
        NODE_ENV: "test",
        JWT_PRIVATE_KEY: otherPem.privateKey,
        JWT_PUBLIC_KEY: otherPem.publicKey,
        JWT_ISSUER: "test-issuer",
        JWT_AUDIENCE: "test-audience",
      } as NodeJS.ProcessEnv),
    );
    const foreign = await other.issue(claims);
    await expect(service.verifyAccessToken(foreign.accessToken)).rejects.toThrow();
  });

  it("rejects a tampered payload", async () => {
    const issued = await service.issue(claims);
    const [header, , signature] = issued.accessToken.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...claims, permissions: ["*"] }),
      "utf8",
    ).toString("base64url");
    await expect(
      service.verifyAccessToken(`${header}.${forged}.${signature}`),
    ).rejects.toThrow();
  });

  it("rejects a token with the wrong audience", async () => {
    const wrongAudience = new TokenService({ ...env, JWT_AUDIENCE: "somewhere-else" });
    const issued = await wrongAudience.issue(claims);
    // Same keys, different audience claim — must still be refused.
    const shared = new TokenService({ ...env, JWT_AUDIENCE: "test-audience" });
    await expect(shared.verifyAccessToken(issued.accessToken)).rejects.toThrow();
  });

  it("issues opaque refresh tokens and stores only their hash", async () => {
    const issued = await service.issue(claims);

    // Not a JWT — nothing to decode, nothing leaked.
    expect(issued.refreshToken.split(".")).toHaveLength(1);
    expect(issued.refreshTokenHash).not.toContain(issued.refreshToken);
    expect(issued.refreshTokenHash).toBe(
      TokenService.hashRefreshToken(issued.refreshToken),
    );
    expect(issued.refreshTokenHash).toHaveLength(64);
  });

  it("issues a distinct refresh token every time", async () => {
    const a = await service.issue(claims);
    const b = await service.issue(claims);
    expect(a.refreshToken).not.toBe(b.refreshToken);
  });

  it("sets the refresh token expiry from configuration", async () => {
    const issued = await service.issue(claims);
    const days = (issued.refreshTokenExpiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });
});
