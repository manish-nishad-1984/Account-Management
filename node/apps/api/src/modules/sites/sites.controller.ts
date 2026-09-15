import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  createSiteSchema,
  hasPermission,
  listQuerySchema,
  saveSiteAddressSchema,
  updateSiteSchema,
  type CreateSite,
  type ListResponse,
  type SaveSiteAddress,
  type SiteAddress,
  type SiteAddressesResponse,
  type SiteDetail,
  type SiteDocumentOptions,
  type SiteRow,
  type SiteScopeResponse,
  type UpdateSite,
} from "@accountmanagement/contracts";
import { SitesRepository } from "./sites.repository";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { actorId } from "../../common/actor";
import type { AccessTokenClaims } from "../auth/token.service";

/** Matches `[FormPermissionAttribute("Site-View")]` in the .NET controllers. */
const SUBJECT = "site";

@Controller("sites")
export class SitesController {
  constructor(private readonly sites: SitesRepository) {}

  @Get()
  @Permissions("site.view")
  async list(
    @Query(new ZodValidationPipe(listQuerySchema)) query: ReturnType<typeof listQuerySchema.parse>,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ListResponse<SiteRow>> {
    const granted = caller?.permissions ?? [];
    const capabilities = {
      canEdit: hasPermission(granted, SUBJECT, "edit"),
      canDelete: hasPermission(granted, SUBJECT, "delete"),
      canApprove: hasPermission(granted, SUBJECT, "approve"),
    };

    const [page, total] = await Promise.all([
      this.sites.list(query),
      this.sites.total(query.search),
    ]);

    return {
      rows: page.rows.map((row) => ({ ...row, capabilities })),
      nextCursor: page.nextCursor,
      total,
    };
  }

  /**
   * The site scope for the application header.
   *
   * DELIBERATELY CARRIES NO `@Permissions`. Every signed-in user needs to pick a
   * site, including one with no `site.view` right — that right guards the Site
   * MASTER screen, where sites are created and edited, and requiring it here
   * would leave a site clerk unable to choose the site they work on. The
   * projection is two columns wide for the same reason.
   *
   * Declared above `@Get(":id")` to read in the obvious order. Fastify routes on
   * a radix tree and prefers the static segment over the parametric one whatever
   * the declaration order, which is how `users/options` and
   * `purchase-requests/approvals` already work — verified against
   * `printRoutes()`, where `assignable` and `:id` are siblings under `sites/`.
   */
  @Get("assignable")
  scope(@CurrentUser() caller: AccessTokenClaims | undefined): Promise<SiteScopeResponse> {
    return this.sites.scopeFor(caller?.sub);
  }

  @Get(":id")
  @Permissions("site.view")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<SiteDetail> {
    return this.sites.findById(id);
  }

  @Post()
  @Permissions("site.add")
  create(
    @Body(new ZodValidationPipe(createSiteSchema)) body: CreateSite,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<SiteDetail> {
    return this.sites.create(body, actorId(caller));
  }

  @Patch(":id")
  @Permissions("site.edit")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSiteSchema)) body: UpdateSite,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<SiteDetail> {
    return this.sites.update(id, body, actorId(caller));
  }

  /** Soft delete. 409 naming the users or locations still attached. */
  @Delete(":id")
  @Permissions("site.delete")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<void> {
    return this.sites.remove(id, actorId(caller));
  }

  /**
   * THE DELIVERY ADDRESSES OF A SITE — nested under it, not a module of their
   * own.
   *
   * An address has no life outside its site: it is never listed across sites,
   * never searched, and its permissions are the site's. A top-level
   * `/site-addresses` resource would have to re-derive which site each row
   * belongs to on every call, and would let an address be moved between sites by
   * changing a field, which nothing should be able to do.
   *
   * The id is an INTEGER here, so `ParseIntPipe` rather than `ParseUUIDPipe`.
   */
  @Get(":id/addresses")
  @Permissions("site.view")
  listAddresses(@Param("id", ParseUUIDPipe) id: string): Promise<SiteAddressesResponse> {
    return this.sites.listAddresses(id).then((rows) => ({ rows }));
  }

  /**
   * The billing address, shipping choices and location names an order or
   * invoice form needs for this site.
   *
   * NO `@Permissions`, like `assignable` above and for the same reason: the
   * people who raise invoices hold `sales-invoice.add`, not `site.view`, and a
   * form they cannot load is a screen they cannot finish. It answers with
   * addresses and location names for one named site and nothing else — no
   * contacts, no counts.
   */
  @Get(":id/document-options")
  documentOptions(@Param("id", ParseUUIDPipe) id: string): Promise<SiteDocumentOptions> {
    return this.sites.documentOptions(id);
  }

  @Post(":id/addresses")
  @Permissions("site.add")
  addAddress(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(saveSiteAddressSchema)) body: SaveSiteAddress,
  ): Promise<SiteAddress> {
    return this.sites.addAddress(id, body);
  }

  @Patch(":id/addresses/:addressId")
  @Permissions("site.edit")
  updateAddress(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("addressId", ParseIntPipe) addressId: number,
    @Body(new ZodValidationPipe(saveSiteAddressSchema)) body: SaveSiteAddress,
  ): Promise<SiteAddress> {
    return this.sites.updateAddress(id, addressId, body);
  }

  @Delete(":id/addresses/:addressId")
  @Permissions("site.delete")
  @HttpCode(204)
  removeAddress(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("addressId", ParseIntPipe) addressId: number,
  ): Promise<void> {
    return this.sites.removeAddress(id, addressId);
  }
}
