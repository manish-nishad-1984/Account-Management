import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { GridColumnPreference, GridPreference } from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { userGridPreferences } from "../../db/schema";
import { BaseRepository } from "../../common/base.repository";

/**
 * Each person's saved column layouts.
 *
 * EVERY METHOD TAKES THE USER ID AS ITS FIRST ARGUMENT, and the controller
 * supplies it from the access token — never from the request. There is no method
 * here that can read or write somebody else's layout, which is why this module
 * needs no permission of its own: the only rule is "your own", and the shape of
 * the interface is what enforces it rather than a check that could be forgotten.
 */
@Injectable()
export class GridPreferencesRepository extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  /**
   * Every layout this person has, in one request.
   *
   * The whole set rather than one grid at a time: there are fourteen grids, each
   * layout is a few hundred bytes, and fetching them together means moving
   * between screens costs nothing and a grid never renders its default columns
   * for a moment before snapping to the chosen ones.
   */
  async list(userId: string): Promise<GridPreference[]> {
    const rows = await this.db
      .select({
        gridKey: userGridPreferences.gridKey,
        columns: userGridPreferences.columns,
      })
      .from(userGridPreferences)
      .where(eq(userGridPreferences.userId, userId));

    return rows.map((row) => ({ gridKey: row.gridKey, columns: row.columns }));
  }

  /**
   * Saves one grid's layout, replacing whatever was there.
   *
   * An upsert on the composite primary key, so saving twice in a row is one row
   * either way and two browser tabs racing cannot produce a duplicate. The
   * alternative — read, then insert or update — has a window between the two
   * where the other tab's insert lands and the second write fails on the key.
   */
  async save(
    userId: string,
    gridKey: string,
    columns: GridColumnPreference[],
  ): Promise<GridPreference> {
    await this.db
      .insert(userGridPreferences)
      .values({ userId, gridKey, columns, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [userGridPreferences.userId, userGridPreferences.gridKey],
        set: { columns, updatedAt: new Date() },
      });

    return { gridKey, columns };
  }

  /**
   * Reset to default, which is a DELETE rather than storing the defaults.
   *
   * Storing them would freeze the grid as it looks today: a column added next
   * month would never appear for anyone who had ever pressed Reset. Absence
   * means "follow the grid", which is what Reset actually means.
   */
  async remove(userId: string, gridKey: string): Promise<void> {
    await this.db
      .delete(userGridPreferences)
      .where(
        and(
          eq(userGridPreferences.userId, userId),
          eq(userGridPreferences.gridKey, gridKey),
        ),
      );
  }
}
