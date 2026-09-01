import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  SignJWT,
  jwtVerify,
  importPKCS8,
  importSPKI,
  generateKeyPair,
  exportPKCS8,
  exportSPKI,
  type JWTPayload,
  type CryptoKey,
} from "jose";
import { randomBytes, createHash } from "node:crypto";
import { ENV, type Env } from "../../config/env";

const ALG = "RS256";

/**
 * The identity carried inside an access token.
 *
 * The .NET token carried NO user id, role or permission claims at all
 * (assessment §3.3), which is why the API performs no per-endpoint authorization
 * and a view-only clerk can approve their own invoices by calling it directly.
 * Everything an authorization decision needs is present here.
 */
export interface AccessTokenClaims extends JWTPayload {
  readonly sub: string;
  readonly permissions: readonly string[];
  /**
   * Sites the user may act on. In the .NET schema this is `User.SiteId`, a CSV
   * string parsed at every call site; here it is a real array, and it becomes a
   * junction table in PostgreSQL.
   */
  readonly siteIds: readonly string[];
  readonly companyIds: readonly string[];
}

export interface IssuedTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly refreshTokenHash: string;
  readonly refreshTokenExpiresAt: Date;
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private keys?: { privateKey: CryptoKey; publicKey: CryptoKey };

  constructor(@Inject(ENV) private readonly env: Env) {}

  private async getKeys(): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }> {
    if (this.keys) {
      return this.keys;
    }

    if (this.env.JWT_PRIVATE_KEY && this.env.JWT_PUBLIC_KEY) {
      this.keys = {
        privateKey: await importPKCS8(this.env.JWT_PRIVATE_KEY, ALG),
        publicKey: await importSPKI(this.env.JWT_PUBLIC_KEY, ALG),
      };
      return this.keys;
    }

    // Development only — loadEnv() refuses to boot production without a pair.
    // Ephemeral, so every restart invalidates previously issued tokens.
    this.logger.warn(
      "No JWT key pair configured; generating an ephemeral one. Tokens will not " +
        "survive a restart. Set JWT_PRIVATE_KEY / JWT_PUBLIC_KEY for anything real.",
    );
    const generated = await generateKeyPair(ALG, { extractable: true });
    this.keys = { privateKey: generated.privateKey, publicKey: generated.publicKey };
    return this.keys;
  }

  async issue(claims: Omit<AccessTokenClaims, "sub"> & { sub: string }): Promise<IssuedTokens> {
    const { privateKey } = await this.getKeys();

    const accessToken = await new SignJWT({
      permissions: claims.permissions,
      siteIds: claims.siteIds,
      companyIds: claims.companyIds,
    })
      .setProtectedHeader({ alg: ALG })
      .setSubject(claims.sub)
      .setIssuer(this.env.JWT_ISSUER)
      .setAudience(this.env.JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(this.env.ACCESS_TOKEN_TTL)
      .sign(privateKey);

    // Refresh tokens are opaque random strings, not JWTs. Only their SHA-256 is
    // stored, so a database leak does not yield usable sessions.
    const refreshToken = randomBytes(32).toString("base64url");
    const refreshTokenExpiresAt = new Date(
      Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    return {
      accessToken,
      refreshToken,
      refreshTokenHash: TokenService.hashRefreshToken(refreshToken),
      refreshTokenExpiresAt,
    };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const { publicKey } = await this.getKeys();
    const { payload } = await jwtVerify(token, publicKey, {
      issuer: this.env.JWT_ISSUER,
      audience: this.env.JWT_AUDIENCE,
      algorithms: [ALG],
    });
    return payload as AccessTokenClaims;
  }

  static hashRefreshToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  /** Generates a PEM pair for JWT_PRIVATE_KEY / JWT_PUBLIC_KEY. */
  static async generatePemPair(): Promise<{ privateKey: string; publicKey: string }> {
    const { privateKey, publicKey } = await generateKeyPair(ALG, { extractable: true });
    return {
      privateKey: await exportPKCS8(privateKey),
      publicKey: await exportSPKI(publicKey),
    };
  }
}
