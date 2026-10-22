import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import type { SaveTermsTemplate, SavedTermsTemplate } from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { termsTemplates } from "../../db/schema";
import { BaseRepository, createdBy, updatedBy } from "../../common/base.repository";
import { writing } from "../../common/db-errors";
import { sanitiseTerms } from "../../common/sanitise-terms";

const COLUMNS = {
  id: termsTemplates.id,
  name: termsTemplates.name,
  html: termsTemplates.html,
  updatedAt: termsTemplates.updatedAt,
  createdAt: termsTemplates.createdAt,
};

type Row = { id: string; name: string; html: string; updatedAt: Date | null; createdAt: Date };

const toTemplate = (row: Row): SavedTermsTemplate => ({
  id: row.id,
  name: row.name,
  html: row.html,
  updatedAt: (row.updatedAt ?? row.createdAt).toISOString(),
});

/** Saved terms and conditions, by name (client, 22 Oct 2026). A few dozen at most: no paging. */
@Injectable()
export class TermsTemplatesRepository extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  async list(): Promise<SavedTermsTemplate[]> {
    const rows = await this.db.select(COLUMNS).from(termsTemplates).orderBy(asc(termsTemplates.name));
    return rows.map(toTemplate);
  }

  /** The same allowlist an order's terms go through; nothing left is refused, not stored blank. */
  private clean(input: SaveTermsTemplate): { name: string; html: string } {
    const html = sanitiseTerms(input.html);
    if (!html) {
      throw new BadRequestException({
        message: "There are no terms to save",
        issues: [{ path: ["html"], message: "There are no terms to save" }],
      });
    }
    return { name: input.name.trim().replace(/\s+/g, " "), html };
  }

  async create(input: SaveTermsTemplate, actorId: string): Promise<SavedTermsTemplate> {
    const [row] = await writing(() =>
      this.db
        .insert(termsTemplates)
        .values({ ...this.clean(input), ...createdBy(actorId) })
        .returning(COLUMNS),
    );
    return toTemplate(row!);
  }

  async update(id: string, input: SaveTermsTemplate, actorId: string): Promise<SavedTermsTemplate> {
    const [row] = await writing(() =>
      this.db
        .update(termsTemplates)
        .set({ ...this.clean(input), ...updatedBy(actorId) })
        .where(eq(termsTemplates.id, id))
        .returning(COLUMNS),
    );
    if (!row) throw new NotFoundException("That template no longer exists");
    return toTemplate(row);
  }

  /** Orders that loaded it keep their own copy of the text; only the template goes. */
  async remove(id: string): Promise<void> {
    const gone = await this.db.delete(termsTemplates).where(eq(termsTemplates.id, id)).returning({ id: termsTemplates.id });
    if (gone.length === 0) throw new NotFoundException("That template no longer exists");
  }
}
