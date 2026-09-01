import { UnauthorizedException } from "@nestjs/common";
import type { AccessTokenClaims } from "../modules/auth/token.service";

/**
 * The id stamped into `created_by` / `updated_by`.
 *
 * Taken from the verified access token and from nowhere else. The source reads
 * it from the posted model — `CreatedBy` is a field on every request DTO — so a
 * crafted request can attribute its own writes to another user, and the audit
 * columns record whatever the caller preferred.
 *
 * Throwing rather than defaulting to null is the point: a write that reached a
 * guarded route without a subject claim means the token shape has changed, and
 * an audit trail that quietly records "unknown" is worse than a failed request.
 */
export function actorId(caller: AccessTokenClaims | undefined): string {
  if (!caller?.sub) {
    throw new UnauthorizedException("The access token carries no subject");
  }
  return caller.sub;
}
