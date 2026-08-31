import { Injectable } from "@nestjs/common";

/**
 * A user as authentication needs it. Note what is absent: there is no field that
 * exposes a credential to a caller. Assessment finding C-2 was that
 * `GET api/Authentication/GetUserById` returned every user's plaintext password
 * to any authenticated caller; the credential never leaves this module.
 */
export interface AuthUser {
  readonly id: string;
  readonly userName: string;
  readonly isActive: boolean;
  /** argon2id hash, or a legacy plaintext value not yet migrated. */
  readonly password: string;
  readonly permissions: readonly string[];
  readonly siteIds: readonly string[];
  readonly companyIds: readonly string[];
}

export interface StoredRefreshToken {
  readonly tokenHash: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

/**
 * Port. The Drizzle/PostgreSQL adapter lands with the database work; until then
 * InMemoryUserRepository backs the tests. Keeping this an interface is what lets
 * the auth logic be fully tested before the schema is settled — the schema is
 * still blocked on the orphan census (assessment blocker 4).
 */
export abstract class UserRepository {
  abstract findByUserName(userName: string): Promise<AuthUser | null>;
  abstract findById(userId: string): Promise<AuthUser | null>;
  abstract updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
  abstract saveRefreshToken(token: StoredRefreshToken): Promise<void>;
  abstract findRefreshToken(tokenHash: string): Promise<StoredRefreshToken | null>;
  abstract revokeRefreshToken(tokenHash: string): Promise<void>;
  abstract revokeAllRefreshTokensForUser(userId: string): Promise<void>;
}

@Injectable()
export class InMemoryUserRepository extends UserRepository {
  private readonly users = new Map<string, AuthUser>();
  private readonly refreshTokens = new Map<string, StoredRefreshToken>();

  seed(user: AuthUser): void {
    this.users.set(user.userName.toLowerCase(), user);
  }

  async findByUserName(userName: string): Promise<AuthUser | null> {
    return this.users.get(userName.toLowerCase()) ?? null;
  }

  async findById(userId: string): Promise<AuthUser | null> {
    for (const user of this.users.values()) {
      if (user.id === userId) {
        return user;
      }
    }
    return null;
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    for (const [key, user] of this.users) {
      if (user.id === userId) {
        this.users.set(key, { ...user, password: passwordHash });
        return;
      }
    }
  }

  async saveRefreshToken(token: StoredRefreshToken): Promise<void> {
    this.refreshTokens.set(token.tokenHash, token);
  }

  async findRefreshToken(tokenHash: string): Promise<StoredRefreshToken | null> {
    return this.refreshTokens.get(tokenHash) ?? null;
  }

  async revokeRefreshToken(tokenHash: string): Promise<void> {
    const existing = this.refreshTokens.get(tokenHash);
    if (existing) {
      this.refreshTokens.set(tokenHash, { ...existing, revokedAt: new Date() });
    }
  }

  async revokeAllRefreshTokensForUser(userId: string): Promise<void> {
    for (const [hash, token] of this.refreshTokens) {
      if (token.userId === userId) {
        this.refreshTokens.set(hash, { ...token, revokedAt: new Date() });
      }
    }
  }
}
