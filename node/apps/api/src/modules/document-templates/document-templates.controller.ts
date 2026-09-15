import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import {
  createDocumentTemplateSchema,
  documentTemplateListQuerySchema,
  hasPermission,
  updateDocumentTemplateSchema,
  type DocumentTemplate,
  type DocumentTemplateList,
  type DocumentType,
  type PrintBundle,
  type RowCapabilities,
} from "@accountmanagement/contracts";
import {
  DocumentTemplatesRepository,
  type TemplateChanges,
  type TemplateInput,
} from "./document-templates.repository";
import { PrintDocumentsRepository } from "./print-documents.repository";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { actorId } from "../../common/actor";
import type { AccessTokenClaims } from "../auth/token.service";

/**
 * THE SUBJECT IS `document-template`, from the form row "Document Template"
 * (id 100) that migration 0018 inserts. There is no legacy form for this — the
 * .NET app has no templates — so the row is new, and the migration grants it to
 * the people who may already edit companies.
 */
const SUBJECT = "document-template";

const capabilitiesOf = (caller: AccessTokenClaims | undefined): RowCapabilities => {
  const granted = caller?.permissions ?? [];
  return {
    canEdit: hasPermission(granted, SUBJECT, "edit"),
    canDelete: hasPermission(granted, SUBJECT, "delete"),
    canApprove: false,
  };
};

@Controller("document-templates")
export class DocumentTemplatesController {
  constructor(private readonly templates: DocumentTemplatesRepository) {}

  @Get()
  @Permissions("document-template.view")
  async list(
    @Query(new ZodValidationPipe(documentTemplateListQuerySchema)) query: { documentType: DocumentType },
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<DocumentTemplateList> {
    return { rows: await this.templates.list(query.documentType, capabilitiesOf(caller)) };
  }

  @Get(":id")
  @Permissions("document-template.view")
  findOne(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<DocumentTemplate> {
    return this.templates.findById(id, capabilitiesOf(caller));
  }

  @Post()
  @Permissions("document-template.add")
  create(
    @Body(new ZodValidationPipe(createDocumentTemplateSchema))
    body: TemplateInput,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<DocumentTemplate> {
    return this.templates.create(body, actorId(caller), capabilitiesOf(caller));
  }

  @Patch(":id")
  @Permissions("document-template.edit")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateDocumentTemplateSchema))
    body: TemplateChanges,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<DocumentTemplate> {
    return this.templates.update(id, body, actorId(caller), capabilitiesOf(caller));
  }

  /** A copy is a new template, so it needs the right to add one. */
  @Post(":id/duplicate")
  @Permissions("document-template.add")
  duplicate(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<DocumentTemplate> {
    return this.templates.duplicate(id, actorId(caller), capabilitiesOf(caller));
  }

  @Put(":id/default")
  @Permissions("document-template.edit")
  makeDefault(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<DocumentTemplate> {
    return this.templates.makeDefault(id, actorId(caller), capabilitiesOf(caller));
  }

  @Delete(":id")
  @Permissions("document-template.delete")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<void> {
    return this.templates.remove(id, actorId(caller));
  }
}

/**
 * A document, ready to print, with the templates that may print it.
 *
 * GUARDED BY THE DOCUMENT'S OWN VIEW RIGHT, not by `document-template`: whoever
 * can open an invoice can print it, and choosing a layout to print with is not
 * managing layouts. One route per document type, because the right differs and
 * `@Permissions` is fixed per route.
 */
@Controller("document-print")
export class DocumentPrintController {
  constructor(
    private readonly documents: PrintDocumentsRepository,
    private readonly templates: DocumentTemplatesRepository,
  ) {}

  @Get("sales-invoice/:id")
  @Permissions("sales-invoice.view")
  async salesInvoice(@Param("id", ParseUUIDPipe) id: string): Promise<PrintBundle> {
    const document = await this.documents.salesInvoice(id);
    return { document, ...(await this.templates.forPrinting("sales-invoice", document.companyId)) };
  }

  @Get("purchase-invoice/:id")
  @Permissions("purchase-invoice.view")
  async purchaseInvoice(@Param("id", ParseUUIDPipe) id: string): Promise<PrintBundle> {
    const document = await this.documents.purchaseInvoice(id);
    return { document, ...(await this.templates.forPrinting("purchase-invoice", document.companyId)) };
  }
}
