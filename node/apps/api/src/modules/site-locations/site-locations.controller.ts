import {
  BadRequestException,
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
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  createSiteLocationsSchema,
  hasPermission,
  listQuerySchema,
  saveSiteLocationsSchema,
  type CreateSiteLocations,
  type ListResponse,
  type SaveSiteLocations,
  type SiteLocationSheetResult,
  type SiteLocationDetail,
  type SiteLocationRow,
} from "@accountmanagement/contracts";
import { SiteLocationsRepository } from "./site-locations.repository";
import { SiteLocationSheetRejected, SiteLocationSheetService } from "./site-location-sheet.service";
import { readUploads } from "../../common/storage/multipart";
import { assertSpreadsheet } from "../../common/spreadsheet/assert-spreadsheet";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { actorId } from "../../common/actor";
import type { AccessTokenClaims } from "../auth/token.service";

/**
 * Subject `group`: the screen is the Site Groups screen renamed, and the rights
 * people hold for it were granted on the legacy `Group` form — add, edit and
 * delete included, which the live rows grant to two users (see the note that
 * stood on the old site-groups controller, 14 Sep 2026). Renaming the subject
 * would take the screen away from everyone who has it.
 *
 * Addressed by SITE id: an entry is a site's two lists, not a record of its own.
 */
const SUBJECT = "group";

@Controller("site-locations")
export class SiteLocationsController {
  constructor(
    private readonly locations: SiteLocationsRepository,
    private readonly sheet: SiteLocationSheetService,
  ) {}

  @Get()
  @Permissions("group.view")
  async list(
    @Query(new ZodValidationPipe(listQuerySchema)) query: ReturnType<typeof listQuerySchema.parse>,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ListResponse<SiteLocationRow>> {
    const granted = caller?.permissions ?? [];
    const capabilities = {
      canEdit: hasPermission(granted, SUBJECT, "edit"),
      canDelete: hasPermission(granted, SUBJECT, "delete"),
      canApprove: hasPermission(granted, SUBJECT, "approve"),
    };

    const [page, total] = await Promise.all([
      this.locations.list(query),
      this.locations.total(query.search),
    ]);

    return {
      rows: page.rows.map((row) => ({ ...row, capabilities })),
      nextCursor: page.nextCursor,
      total,
    };
  }

  /**
   * "Import locations": a sheet of Site location + Location Address, applied to
   * the one site named in `siteId` (client, 14 Oct 2026). Adds names and sets
   * addresses, so it needs the add AND edit rights. All or nothing: a bad row
   * answers 400 with every problem and nothing is saved.
   */
  @Post("import")
  @Permissions("group.add", "group.edit")
  @HttpCode(200)
  async importSheet(
    @Req() request: FastifyRequest,
    @Query("siteId", ParseUUIDPipe) siteId: string,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<SiteLocationSheetResult> {
    const files = await readUploads(request);
    if (files.length !== 1) {
      throw new BadRequestException("Send one spreadsheet, not several.");
    }
    const file = files[0]!;
    assertSpreadsheet(file.fileName, file.bytes);

    try {
      return await this.sheet.import(file.bytes, siteId, actorId(caller));
    } catch (error) {
      if (error instanceof SiteLocationSheetRejected) {
        throw new BadRequestException({
          message: `Nothing was imported. ${error.result.errors.length} ${
            error.result.errors.length === 1 ? "problem" : "problems"
          } to fix.`,
          ...error.result,
        });
      }
      throw error;
    }
  }

  @Get(":siteId")
  @Permissions("group.view")
  findOne(@Param("siteId", ParseUUIDPipe) siteId: string): Promise<SiteLocationDetail> {
    return this.locations.findBySite(siteId);
  }

  /** 409 when the site already has locations — that is an edit. */
  @Post()
  @Permissions("group.add")
  create(
    @Body(new ZodValidationPipe(createSiteLocationsSchema)) body: CreateSiteLocations,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<SiteLocationDetail> {
    const { siteId, ...lists } = body;
    return this.locations.create(siteId, lists, actorId(caller));
  }

  @Patch(":siteId")
  @Permissions("group.edit")
  update(
    @Param("siteId", ParseUUIDPipe) siteId: string,
    @Body(new ZodValidationPipe(saveSiteLocationsSchema)) body: SaveSiteLocations,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<SiteLocationDetail> {
    return this.locations.save(siteId, body, actorId(caller));
  }

  /** Empties the site's lists. Documents keep the location names they carry. */
  @Delete(":siteId")
  @Permissions("group.delete")
  @HttpCode(204)
  remove(
    @Param("siteId", ParseUUIDPipe) siteId: string,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<void> {
    return this.locations.remove(siteId, actorId(caller));
  }
}
