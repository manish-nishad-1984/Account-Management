import { ServiceUnavailableException } from "@nestjs/common";
import type { Database } from "../db/database";

/**
 * What every repository shares: the database handle, and one honest answer when
 * there isn't one.
 *
 * `DATABASE` is null when no `DATABASE_URL` is configured — the mode that lets
 * the API boot for auth-only work against the in-memory user repository. A
 * repository that dereferenced it would throw `TypeError: cannot read property
 * 'select' of null` and surface as a 500, which says nothing useful. 503 with the
 * variable to set says what to do.
 */
export abstract class BaseRepository {
  constructor(private readonly injected: Database | null) {}

  protected get db(): Database {
    if (!this.injected) {
      throw new ServiceUnavailableException(
        "No database is configured. Set DATABASE_URL to use this endpoint.",
      );
    }
    return this.injected;
  }
}

/**
 * The audit columns a create stamps.
 *
 * `createdBy` is the caller's user id from the access token, never a value the
 * request body supplied. The source takes it from the posted model, so a
 * crafted request can attribute its own writes to somebody else.
 */
export const createdBy = (actorId: string) => ({ createdBy: actorId });

/**
 * The audit columns an update stamps.
 *
 * `updatedAt` is set explicitly rather than by a trigger or `defaultNow()`,
 * because a column default only applies on INSERT. `Site.UpdatedOn` in the
 * source is left null by several update paths for exactly that reason.
 */
export const updatedBy = (actorId: string) => ({
  updatedBy: actorId,
  updatedAt: new Date(),
});
