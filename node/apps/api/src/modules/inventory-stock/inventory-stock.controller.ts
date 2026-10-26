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
  Res,
} from "@nestjs/common";
import { z } from "zod";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  createAgencyPersonSchema,
  createInventoryIssueSchema,
  hasPermission,
  inventoryIssueQuerySchema,
  receiveInventoryIssueSchema,
  saveInventoryItemSchema,
  type AgencyPerson,
  type CreateAgencyPerson,
  type CreateInventoryIssue,
  type InventoryIssueQuery,
  type InventoryIssueRow,
  type InventoryItemRow,
  type PhotoUpload,
  type PurchaseStockRow,
  type ReceiveInventoryIssue,
  type SaveInventoryItem,
} from "@accountmanagement/contracts";
import { InventoryStockRepository } from "./inventory-stock.repository";
import { InventoryPhotosService } from "./inventory-photos.service";
import { readUploads } from "../../common/storage/multipart";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { actorId } from "../../common/actor";
import type { AccessTokenClaims } from "../auth/token.service";

/**
 * Stock, issue and receive back (client, 26 Oct 2026). All under the right of
 * the Inventory screen the client keys New Arrival on, so whoever runs the
 * store at a site needs no new right: view to see, add to issue and receive,
 * edit to change the item master, delete to take a mistake off.
 */
const SUBJECT = "inventory-inward";

const capabilitiesOf = (caller: AccessTokenClaims | undefined) => {
  const granted = caller?.permissions ?? [];
  return {
    canEdit: hasPermission(granted, SUBJECT, "add"),
    canDelete: hasPermission(granted, SUBJECT, "delete"),
    canApprove: false,
  };
};

const siteQuerySchema = z.object({ siteId: z.string().uuid().optional() });
const requiredSiteSchema = z.object({ siteId: z.string().uuid() });
const agencyQuerySchema = z.object({ agencyId: z.string().uuid() });

/** A photo, served as what its bytes are, private to the person who asked. */
async function sendPhoto(reply: FastifyReply, photo: { bytes: Buffer; contentType: string }): Promise<void> {
  await reply
    .header("Content-Type", photo.contentType)
    .header("Content-Length", photo.bytes.byteLength)
    .header("X-Content-Type-Options", "nosniff")
    .header("Cache-Control", "private, max-age=3600")
    .send(photo.bytes);
}

@Controller("inventory-photos")
export class InventoryPhotosController {
  constructor(private readonly photos: InventoryPhotosService) {}

  /** One photo up, its key back; the form then names it. */
  @Post()
  @Permissions("inventory-inward.add")
  @HttpCode(200)
  async upload(@Req() request: FastifyRequest): Promise<PhotoUpload> {
    const files = await readUploads(request);
    if (files.length !== 1) throw new BadRequestException("Send one photo.");
    return { photoKey: await this.photos.save(files[0]!) };
  }
}

@Controller("inventory-items")
export class InventoryItemsController {
  constructor(
    private readonly stock: InventoryStockRepository,
    private readonly photos: InventoryPhotosService,
  ) {}

  @Get()
  @Permissions("inventory-inward.view")
  async list(
    @Query(new ZodValidationPipe(siteQuerySchema)) query: { siteId?: string },
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<{ rows: InventoryItemRow[] }> {
    const capabilities = capabilitiesOf(caller);
    return { rows: (await this.stock.items(query.siteId)).map((row) => ({ ...row, capabilities })) };
  }

  @Post()
  @Permissions("inventory-inward.edit")
  async create(
    @Body(new ZodValidationPipe(saveInventoryItemSchema)) body: SaveInventoryItem,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<{ id: string }> {
    await this.photos.assertUploaded(body.photoKey);
    return this.stock.createItem(body, actorId(caller));
  }

  @Patch(":id")
  @Permissions("inventory-inward.edit")
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(saveInventoryItemSchema)) body: SaveInventoryItem,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<{ id: string }> {
    await this.photos.assertUploaded(body.photoKey);
    return this.stock.updateItem(id, body, actorId(caller));
  }

  @Delete(":id")
  @Permissions("inventory-inward.delete")
  @HttpCode(204)
  remove(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() caller: AccessTokenClaims | undefined): Promise<void> {
    return this.stock.removeItem(id, actorId(caller));
  }

  @Get(":id/photo")
  @Permissions("inventory-inward.view")
  async photo(@Param("id", ParseUUIDPipe) id: string, @Res() reply: FastifyReply): Promise<void> {
    await sendPhoto(reply, await this.photos.read(await this.stock.itemPhotoKey(id)));
  }
}

@Controller("agency-persons")
export class AgencyPersonsController {
  constructor(
    private readonly stock: InventoryStockRepository,
    private readonly photos: InventoryPhotosService,
  ) {}

  @Get()
  @Permissions("inventory-inward.view")
  list(@Query(new ZodValidationPipe(agencyQuerySchema)) query: { agencyId: string }): Promise<AgencyPerson[]> {
    return this.stock.persons(query.agencyId);
  }

  @Post()
  @Permissions("inventory-inward.add")
  async create(
    @Body(new ZodValidationPipe(createAgencyPersonSchema)) body: CreateAgencyPerson,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<AgencyPerson> {
    await this.photos.assertUploaded(body.photoKey);
    return this.stock.createPerson(body, actorId(caller));
  }

  @Get(":id/photo")
  @Permissions("inventory-inward.view")
  async photo(@Param("id", ParseUUIDPipe) id: string, @Res() reply: FastifyReply): Promise<void> {
    await sendPhoto(reply, await this.photos.read(await this.stock.personPhotoKey(id)));
  }
}

@Controller("inventory-issues")
export class InventoryIssuesController {
  constructor(
    private readonly stock: InventoryStockRepository,
    private readonly photos: InventoryPhotosService,
  ) {}

  @Get()
  @Permissions("inventory-inward.view")
  async list(
    @Query(new ZodValidationPipe(inventoryIssueQuerySchema)) query: InventoryIssueQuery,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<{ rows: InventoryIssueRow[] }> {
    const capabilities = capabilitiesOf(caller);
    return { rows: (await this.stock.issues(query)).map((row) => ({ ...row, capabilities })) };
  }

  /** The purchase items a site has, with their stock, for the issue form. */
  @Get("purchase-stock")
  @Permissions("inventory-inward.view")
  purchaseStock(@Query(new ZodValidationPipe(requiredSiteSchema)) query: { siteId: string }): Promise<PurchaseStockRow[]> {
    return this.stock.purchaseStock(query.siteId);
  }

  /** The agencies and their contacts, for the issue form, without the Agency Master's right. */
  @Get("agencies")
  @Permissions("inventory-inward.view")
  agencies() {
    return this.stock.agencies();
  }

  @Post()
  @Permissions("inventory-inward.add")
  async issue(
    @Body(new ZodValidationPipe(createInventoryIssueSchema)) body: CreateInventoryIssue,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<InventoryIssueRow> {
    return { ...(await this.stock.issue(body, actorId(caller))), capabilities: capabilitiesOf(caller) };
  }

  @Post(":id/receive")
  @Permissions("inventory-inward.add")
  @HttpCode(200)
  async receive(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(receiveInventoryIssueSchema)) body: ReceiveInventoryIssue,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<InventoryIssueRow> {
    return { ...(await this.stock.receive(id, body, actorId(caller))), capabilities: capabilitiesOf(caller) };
  }

  @Delete(":id")
  @Permissions("inventory-inward.delete")
  @HttpCode(204)
  remove(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() caller: AccessTokenClaims | undefined): Promise<void> {
    return this.stock.removeIssue(id, actorId(caller));
  }

  /** The photo of what arrived on a New Arrival. Here, beside the stock it went into. */
  @Get("arrivals/:id/photo")
  @Permissions("inventory-inward.view")
  async arrivalPhoto(@Param("id", ParseUUIDPipe) id: string, @Res() reply: FastifyReply): Promise<void> {
    await sendPhoto(reply, await this.photos.read(await this.stock.arrivalPhotoKey(id)));
  }
}
