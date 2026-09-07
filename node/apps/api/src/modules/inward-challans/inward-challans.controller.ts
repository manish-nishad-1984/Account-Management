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
} from "@nestjs/common";
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
  constructor(private readonly challans: InwardChallansRepository) {}

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

  /*
   * THERE IS NO UPLOAD ENDPOINT YET, and that is the one thing this module does
   * not finish.
   *
   * `inward_challan_documents` records file NAMES, which is all the source's own
   * table records — the bytes live on the old web server's disk. Accepting a file
   * here needs three things that are not a code decision: somewhere to put it
   * (assessment 12 says object storage; the alternative is the VPS disk, which is
   * what happens today), a multipart dependency the API does not carry, and a
   * deploy change for the body-size limit and the writable path.
   *
   * Existing attachments are listed and counted. Adding one is the next change.
   */
}
