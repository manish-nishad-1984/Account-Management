import { Injectable } from "@nestjs/common";
import { hash, verify, Algorithm } from "@node-rs/argon2";
import { timingSafeEqual } from "node:crypto";

export interface VerifyResult {
  /** Whether the supplied password is correct. */
  readonly ok: boolean;
  /**
   * True when the stored credential is a legacy plaintext password that has just
   * been proven correct. The caller must re-store it as a hash — this is the
   * migration path off assessment finding C-1.
   */
  readonly needsRehash: boolean;
}

/**
 * Password hashing.
 *
 * The .NET system stores and compares passwords in plaintext
 * (`UserAuthentication.cs:409` — `tblUser.User.Password != loginRequest.Password`)
 * and returns them over HTTP from GetUserById. Both are fixed here: passwords are
 * argon2id hashes, and nothing in this codebase ever returns a credential.
 *
 * Existing rows cannot be converted in bulk, because a plaintext password cannot
 * be turned into a hash without the user — it already IS the plaintext, so we hash
 * it the first time they successfully log in and overwrite the column. Until then
 * `verify` accepts a legacy value and reports needsRehash.
 */
@Injectable()
export class PasswordService {
  // OWASP-recommended argon2id baseline: 19 MiB, 2 iterations, parallelism 1.
  private static readonly OPTIONS = {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  } as const;

  async hash(plain: string): Promise<string> {
    return hash(plain, PasswordService.OPTIONS);
  }

  /** True if the stored value is already an argon2 hash rather than legacy plaintext. */
  isHashed(stored: string): boolean {
    return stored.startsWith("$argon2");
  }

  async verify(stored: string, supplied: string): Promise<VerifyResult> {
    if (this.isHashed(stored)) {
      try {
        return { ok: await verify(stored, supplied), needsRehash: false };
      } catch {
        // Malformed hash — treat as a failed login, never as a pass.
        return { ok: false, needsRehash: false };
      }
    }

    // Legacy plaintext row. Compare in constant time so this path does not leak
    // password length or content through timing, the way `!=` did.
    return { ok: constantTimeEquals(stored, supplied), needsRehash: true };
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // timingSafeEqual throws on length mismatch. Compare against self to burn a
    // comparable amount of time, then fail.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
