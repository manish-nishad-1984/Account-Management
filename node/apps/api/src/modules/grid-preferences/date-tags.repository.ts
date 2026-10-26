import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";
import type { DateTag, SaveDateTag } from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { exportDateTags } from "../../db/schema";
import { BaseRepository } from "../../common/base.repository";

const COLUMNS = { id: exportDateTags.id, name: exportDateTags.name, fromDate: exportDateTags.fromDate, toDate: exportDateTags.toDate };

/** Each person's named date ranges for the Excel Export (client, 26 Oct 2026). */
@Injectable()
export class DateTagsRepository extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  async list(userId: string): Promise<DateTag[]> {
    return this.db.select(COLUMNS).from(exportDateTags).where(eq(exportDateTags.userId, userId)).orderBy(asc(sql`lower(${exportDateTags.name})`));
  }

  async create(userId: string, input: SaveDateTag): Promise<DateTag> {
    const [clash] = await this.db
      .select({ id: exportDateTags.id })
      .from(exportDateTags)
      .where(and(eq(exportDateTags.userId, userId), sql`lower(${exportDateTags.name}) = lower(${input.name})`));
    if (clash) throw new ConflictException(`You already have a tag named "${input.name}".`);
    const [row] = await this.db
      .insert(exportDateTags)
      .values({ userId, name: input.name, fromDate: input.fromDate, toDate: input.toDate })
      .returning(COLUMNS);
    return row!;
  }

  /** Only the caller's own tag; another person's id is a 404, as though it did not exist. */
  async remove(userId: string, id: string): Promise<void> {
    const [row] = await this.db
      .delete(exportDateTags)
      .where(and(eq(exportDateTags.id, id), eq(exportDateTags.userId, userId)))
      .returning({ id: exportDateTags.id });
    if (!row) throw new NotFoundException("Tag not found");
  }
}
