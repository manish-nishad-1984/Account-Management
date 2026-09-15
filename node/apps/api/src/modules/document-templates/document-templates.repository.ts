import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import {
  DOCUMENT_TEMPLATE_LIMIT,
  templateLayoutSchema,
  type DocumentTemplate,
  type DocumentType,
  type PrintBundle,
  type RowCapabilities,
  type TemplateLayout,
} from "@accountmanagement/contracts";
import { DATABASE, type Database } from "../../db/database";
import { companies, documentTemplates } from "../../db/schema";
import { BaseRepository, createdBy, updatedBy } from "../../common/base.repository";
import { writing } from "../../common/db-errors";

/** What the controller hands over, after the contract schemas have parsed it. */
export interface TemplateInput {
  documentType: DocumentType;
  companyId: string | null;
  name: string;
  basedOn: DocumentTemplate["basedOn"];
  layout: TemplateLayout;
}

export type TemplateChanges = Partial<Pick<TemplateInput, "companyId" | "name" | "layout">>;

const COLUMNS = {
  id: documentTemplates.id,
  documentType: documentTemplates.documentType,
  companyId: documentTemplates.companyId,
  companyName: companies.name,
  name: documentTemplates.name,
  basedOn: documentTemplates.basedOn,
  isDefault: documentTemplates.isDefault,
  layout: documentTemplates.layout,
  updatedAt: documentTemplates.updatedAt,
};

type Stored = {
  id: string;
  documentType: string;
  companyId: string | null;
  companyName: string | null;
  name: string;
  basedOn: string;
  isDefault: boolean;
  layout: TemplateLayout;
  updatedAt: Date;
};

/**
 * A layout is validated again on the way OUT, so a row written by an older
 * build, or by hand, comes back with today's defaults filled in rather than as
 * a shape the renderer does not expect.
 */
const toTemplate = (row: Stored, capabilities: RowCapabilities): DocumentTemplate => ({
  id: row.id,
  documentType: row.documentType as DocumentType,
  companyId: row.companyId,
  companyName: row.companyName,
  name: row.name,
  basedOn: row.basedOn as DocumentTemplate["basedOn"],
  isDefault: row.isDefault,
  layout: templateLayoutSchema.parse(row.layout),
  updatedAt: row.updatedAt.toISOString(),
  capabilities,
});

@Injectable()
export class DocumentTemplatesRepository extends BaseRepository {
  constructor(@Inject(DATABASE) database: Database | null) {
    super(database);
  }

  /** Every template for one document type, defaults first, then by name. */
  async list(documentType: DocumentType, capabilities: RowCapabilities): Promise<DocumentTemplate[]> {
    const rows = await this.db
      .select(COLUMNS)
      .from(documentTemplates)
      .leftJoin(companies, eq(companies.id, documentTemplates.companyId))
      .where(and(eq(documentTemplates.documentType, documentType), eq(documentTemplates.isDeleted, false)))
      .orderBy(desc(documentTemplates.isDefault), asc(documentTemplates.name), asc(documentTemplates.createdAt))
      .limit(DOCUMENT_TEMPLATE_LIMIT);

    return rows.map((row) => toTemplate(row, capabilities));
  }

  async findById(id: string, capabilities: RowCapabilities): Promise<DocumentTemplate> {
    const [row] = await this.db
      .select(COLUMNS)
      .from(documentTemplates)
      .leftJoin(companies, eq(companies.id, documentTemplates.companyId))
      .where(and(eq(documentTemplates.id, id), eq(documentTemplates.isDeleted, false)))
      .limit(1);

    if (!row) throw new NotFoundException("Template not found");
    return toTemplate(row, capabilities);
  }

  /**
   * A new template is never the default: making one the default is its own,
   * deliberate action, and a copy that silently took over printing would change
   * every invoice printed afterwards.
   */
  async create(
    input: TemplateInput,
    actorId: string,
    capabilities: RowCapabilities,
  ): Promise<DocumentTemplate> {
    await this.requireCompany(input.companyId);
    const [row] = await writing(() =>
      this.db
        .insert(documentTemplates)
        .values({
          documentType: input.documentType,
          companyId: input.companyId,
          name: input.name,
          basedOn: input.basedOn,
          layout: input.layout,
          ...createdBy(actorId),
          updatedBy: actorId,
        })
        .returning({ id: documentTemplates.id }),
    );
    return this.findById(row!.id, capabilities);
  }

  /**
   * A partial update. Moving a DEFAULT template to another company would carry
   * its default flag into a scope that may already have one, so that is refused
   * rather than resolved by quietly unsetting either of them.
   */
  async update(
    id: string,
    input: TemplateChanges,
    actorId: string,
    capabilities: RowCapabilities,
  ): Promise<DocumentTemplate> {
    const current = await this.findById(id, capabilities);

    if (input.companyId !== undefined) {
      const next = input.companyId ?? null;
      await this.requireCompany(next);
      if (current.isDefault && next !== current.companyId) {
        throw new ConflictException({
          message: "This template is a default. Make another template the default before moving it to a different company.",
          issues: [{ path: "companyId", message: "A default template cannot change company" }],
        });
      }
    }

    await writing(() =>
      this.db
        .update(documentTemplates)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.companyId !== undefined ? { companyId: input.companyId ?? null } : {}),
          ...(input.layout !== undefined ? { layout: input.layout } : {}),
          ...updatedBy(actorId),
        })
        .where(and(eq(documentTemplates.id, id), eq(documentTemplates.isDeleted, false))),
    );
    return this.findById(id, capabilities);
  }

  /** A copy, named as one, never the default. */
  async duplicate(id: string, actorId: string, capabilities: RowCapabilities): Promise<DocumentTemplate> {
    const source = await this.findById(id, capabilities);
    return this.create(
      {
        documentType: source.documentType,
        companyId: source.companyId,
        name: `${source.name} (copy)`.slice(0, 100),
        basedOn: source.basedOn,
        layout: source.layout,
      },
      actorId,
      capabilities,
    );
  }

  /**
   * Makes a template the default for its document type and company, and
   * un-defaults whichever template held that place — in one transaction, so
   * there is never a moment with two defaults or none.
   *
   * The partial unique index is the backstop: two of these racing each other
   * end with one success and one conflict, not two defaults.
   */
  async makeDefault(id: string, actorId: string, capabilities: RowCapabilities): Promise<DocumentTemplate> {
    const target = await this.findById(id, capabilities);

    await writing(() =>
      this.db.transaction(async (tx) => {
        await tx
          .update(documentTemplates)
          .set({ isDefault: false, ...updatedBy(actorId) })
          .where(
            and(
              eq(documentTemplates.documentType, target.documentType),
              target.companyId === null
                ? isNull(documentTemplates.companyId)
                : eq(documentTemplates.companyId, target.companyId),
              eq(documentTemplates.isDefault, true),
              eq(documentTemplates.isDeleted, false),
            ),
          );
        await tx
          .update(documentTemplates)
          .set({ isDefault: true, ...updatedBy(actorId) })
          .where(eq(documentTemplates.id, id));
      }),
    );
    return this.findById(id, capabilities);
  }

  /**
   * Soft delete. A default is refused: deleting it would silently hand that
   * company's printing to a different layout, which is a change someone should
   * make on purpose by choosing the new default first.
   */
  async remove(id: string, actorId: string): Promise<void> {
    const [row] = await this.db
      .select({ isDefault: documentTemplates.isDefault })
      .from(documentTemplates)
      .where(and(eq(documentTemplates.id, id), eq(documentTemplates.isDeleted, false)))
      .limit(1);

    if (!row) throw new NotFoundException("Template not found");
    if (row.isDefault) {
      throw new ConflictException({
        message: "This template is the default. Make another template the default before deleting it.",
      });
    }

    await this.db
      .update(documentTemplates)
      .set({ isDeleted: true, ...updatedBy(actorId) })
      .where(eq(documentTemplates.id, id));
  }

  /**
   * The templates that may print a document of this company: its own and the
   * every-company ones. The company's default wins over the every-company one.
   */
  async forPrinting(
    documentType: DocumentType,
    companyId: string,
  ): Promise<Pick<PrintBundle, "templates" | "defaultTemplateId">> {
    const rows = await this.db
      .select({
        id: documentTemplates.id,
        name: documentTemplates.name,
        companyId: documentTemplates.companyId,
        isDefault: documentTemplates.isDefault,
        layout: documentTemplates.layout,
      })
      .from(documentTemplates)
      .where(
        and(
          eq(documentTemplates.documentType, documentType),
          eq(documentTemplates.isDeleted, false),
          or(isNull(documentTemplates.companyId), eq(documentTemplates.companyId, companyId)),
        ),
      )
      .orderBy(
        // This company's own templates before the shared ones.
        sql`${documentTemplates.companyId} is null`,
        desc(documentTemplates.isDefault),
        asc(documentTemplates.name),
      )
      .limit(DOCUMENT_TEMPLATE_LIMIT);

    const templates = rows.map((row) => ({ ...row, layout: templateLayoutSchema.parse(row.layout) }));
    const own = templates.find((t) => t.isDefault && t.companyId === companyId);
    const shared = templates.find((t) => t.isDefault && t.companyId === null);

    return { templates, defaultTemplateId: (own ?? shared)?.id ?? null };
  }

  private async requireCompany(companyId: string | null): Promise<void> {
    if (companyId === null) return;
    const [row] = await this.db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.id, companyId), eq(companies.isDeleted, false)))
      .limit(1);
    if (!row) {
      throw new BadRequestException({
        message: "That company does not exist",
        issues: [{ path: "companyId", message: "Choose a company" }],
      });
    }
  }
}
