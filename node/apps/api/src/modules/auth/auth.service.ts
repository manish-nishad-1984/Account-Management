import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";
import { UserRepository, type AuthUser } from "./user.repository";

export interface LoginResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly user: {
    readonly id: string;
    readonly userName: string;
    readonly permissions: readonly string[];
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UserRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async login(userName: string, password: string): Promise<LoginResult> {
    const user = await this.users.findByUserName(userName);

    // One message and one code for every failure below: unknown user, wrong
    // password, inactive account. Distinguishing them turns the login form into a
    // user-enumeration oracle.
    if (!user) {
      // Still hash, so a missing user does not return measurably faster than a
      // wrong password.
      await this.passwords.hash(password);
      throw new UnauthorizedException("Invalid username or password");
    }

    const result = await this.passwords.verify(user.password, password);
    if (!result.ok) {
      throw new UnauthorizedException("Invalid username or password");
    }

    if (!user.isActive) {
      throw new UnauthorizedException("Invalid username or password");
    }

    // Transparent migration off plaintext (assessment finding C-1). The user has
    // just proven the password, so this is the only moment it can be hashed.
    if (result.needsRehash) {
      const hashed = await this.passwords.hash(password);
      await this.users.updatePasswordHash(user.id, hashed);
      this.logger.log({ userId: user.id }, "Migrated legacy plaintext password to argon2id");
    }

    return this.issueFor(user);
  }

  async refresh(refreshToken: string): Promise<LoginResult> {
    const tokenHash = TokenService.hashRefreshToken(refreshToken);
    const stored = await this.users.findRefreshToken(tokenHash);

    if (!stored || stored.revokedAt !== null || stored.expiresAt <= new Date()) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    const user = await this.users.findById(stored.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    // Rotation: the presented token is spent immediately, so replaying it fails.
    await this.users.revokeRefreshToken(tokenHash);
    return this.issueFor(user);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.users.revokeRefreshToken(TokenService.hashRefreshToken(refreshToken));
  }

  private async issueFor(user: AuthUser): Promise<LoginResult> {
    const issued = await this.tokens.issue({
      sub: user.id,
      permissions: user.permissions,
      siteIds: user.siteIds,
      companyIds: user.companyIds,
    });

    await this.users.saveRefreshToken({
      tokenHash: issued.refreshTokenHash,
      userId: user.id,
      expiresAt: issued.refreshTokenExpiresAt,
      revokedAt: null,
    });

    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      user: {
        id: user.id,
        userName: user.userName,
        permissions: user.permissions,
      },
    };
  }
}
