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
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  createInwardChallanSchema,
  hasPermission,
  listQuerySchema,
  setApprovalSchema,
  updateInwardChallanSchema,
  type CreateInwardChallan,
  type InwardChallanDetail,
  type InwardChallanListResponse,
  type SetApproval,
  type UpdateInwardChallan,
} from "@accountmanagement/contracts";
import { InwardChallansRepository } from "./inward-challans.repository";
import { InwardChallanDocumentsService } from "./inward-challan-documents.service";
import { readUploads } from "../../common/storage/multipart";
import { contentDisposition } from "../../common/storage/content-disposition";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { actorId } from "../../common/actor";
import type { AccessTokenClaims } from "../auth/token.service";

/** From `Form.FormName` = "Inward Challan", not from the `ItemInWord` controller. */
const SUBJECT = "inward-challan";

/**
 * Query-string filters. Everything arrives as a string, so booleans are coerced
 * explicitly rather than left to truthiness, where "false" is true.
 */
const filterSchema = z.object({
  siteId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  isApproved: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
});

const listRequestSchema = listQuerySchema.and(filterSchema);

@Controller("inward-challans")
export class InwardChallansController {
  constructor(
    private readonly challans: InwardChallansRepository,
    private readonly documents: InwardChallanDocumentsService,
  ) {}

  @Get()
  @Permissions("inward-challan.view")
  async list(
    @Query(new ZodValidationPipe(listRequestSchema))
    query: ReturnType<typeof listRequestSchema.parse>,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<InwardChallanListResponse> {
    const granted = caller?.permissions ?? [];
    const capabilities = {
      canEdit: hasPermission(granted, SUBJECT, "edit"),
      canDelete: hasPermission(granted, SUBJECT, "delete"),
      canApprove: hasPermission(granted, SUBJECT, "approve"),
    };

    const filters = {
      siteId: query.siteId,
      supplierId: query.supplierId,
      itemId: query.itemId,
      isApproved: query.isApproved,
      fromDate: query.fromDate,
      toDate: query.toDate,
    };

    const [page, totals] = await Promise.all([
      this.challans.list(query, filters),
      this.challans.totals(query.search, filters),
    ]);

    return {
      rows: page.rows.map((row) => ({ ...row, capabilities })),
      nextCursor: page.nextCursor,
      total: totals.rows,
      /**
       * The grid's footer aggregate, over the whole filtered set rather than the
       * page. A field on the response, not a value smuggled onto `list[0]` where
       * it disappears the moment the filter matches nothing.
       */
      totalQuantity: totals.quantity,
    };
  }

  @Get(":id")
  @Permissions("inward-challan.view")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<InwardChallanDetail> {
    return this.challans.findById(id);
  }

  @Post()
  @Permissions("inward-challan.add")
  create(
    @Body(new ZodValidationPipe(createInwardChallanSchema)) body: CreateInwardChallan,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<InwardChallanDetail> {
    return this.challans.create(body, actorId(caller));
  }

  @Patch(":id")
  @Permissions("inward-challan.edit")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateInwardChallanSchema)) body: UpdateInwardChallan,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<InwardChallanDetail> {
    return this.challans.update(id, body, actorId(caller));
  }

  /** Its own right. `ItemInWordIsApproved` checks nothing at all. */
  @Patch(":id/approval")
  @Permissions("inward-challan.approve")
  setApproval(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setApprovalSchema)) body: SetApproval,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<InwardChallanDetail> {
    return this.challans.setApproval(id, body.isApproved, actorId(caller));
  }

  @Delete(":id")
  @Permissions("inward-challan.delete")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<void> {
    return this.challans.remove(id, actorId(caller));
  }

  /**
   * Attach one or more files. `multipart/form-data`, field name `files`.
   *
   * Requires `edit`, not `add`: attaching changes an existing challan, and
   * anyone who may not change a challan may not change what is attached to it.
   *
   * Returns the whole challan rather than the new documents alone, so a client
   * refreshes one thing and cannot end up displaying a stale attachment list
   * beside a fresh challan.
   */
  @Post(":id/documents")
  @Permissions("inward-challan.edit")
  async attach(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<InwardChallanDetail> {
    const uploads = await readUploads(request);
    await this.documents.attach(id, uploads, actorId(caller));
    return this.challans.findById(id);
  }

  /**
   * Download one attachment.
   *
   * THIS ENDPOINT IS THE FIX FOR FINDING H-9. The legacy application wrote every
   * upload into `wwwroot/Content/InWordDocument/` and let the web server hand it
   * out: no login, no permission, no site scope — a URL and a guessable file name
   * were the whole of the access control. Here the bytes live outside anything
   * nginx serves and come back only through a request that carried a token and
   * passed `inward-challan.view`.
   *
   * Three headers matter and all three are deliberate:
   *
   *   Content-Type          from the row, written from the file's SNIFFED
   *                         signature at upload — never echoed from the client.
   *   X-Content-Type-Options nosniff, so a browser cannot decide for itself that
   *                         something is HTML and run it on this origin.
   *   Content-Disposition   attachment, so nothing renders in a tab at all.
   *
   * Together they mean that even a file whose contents lie is inert.
   */
  @Get(":id/documents/:documentId")
  @Permissions("inward-challan.view")
  async download(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("documentId", ParseUUIDPipe) documentId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = await this.documents.read(id, documentId);

    await reply
      .header("Content-Type", file.contentType)
      .header("Content-Length", file.bytes.byteLength)
      .header("Content-Disposition", contentDisposition(file.documentName))
      .header("X-Content-Type-Options", "nosniff")
      // An attachment is as private as the challan it hangs off. Nothing about
      // it should sit in a shared cache.
      .header("Cache-Control", "private, no-store")
      .send(file.bytes);
  }

  /** Removes the row and the bytes. `edit`, for the same reason as attaching. */
  @Delete(":id/documents/:documentId")
  @Permissions("inward-challan.edit")
  @HttpCode(204)
  detach(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("documentId", ParseUUIDPipe) documentId: string,
  ): Promise<void> {
    return this.documents.detach(id, documentId);
  }
}
