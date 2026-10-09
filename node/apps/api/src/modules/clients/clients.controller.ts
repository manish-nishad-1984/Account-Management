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
  createClientSchema,
  hasPermission,
  listQuerySchema,
  updateClientSchema,
  type ClientDetail,
  type ClientRow,
  type CreateClient,
  type ListResponse,
  type UpdateClient,
} from "@accountmanagement/contracts";
import { ClientsRepository } from "./clients.repository";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { actorId } from "../../common/actor";
import type { AccessTokenClaims } from "../auth/token.service";

/** Subject `client`, from the form row "Client" that migration 0025 inserts. */
const SUBJECT = "client";

const listRequestSchema = listQuerySchema.and(z.object({ siteId: z.string().uuid().optional() }));

@Controller("clients")
export class ClientsController {
  constructor(private readonly clients: ClientsRepository) {}

  @Get()
  @Permissions("client.view")
  async list(
    @Query(new ZodValidationPipe(listRequestSchema)) query: ReturnType<typeof listRequestSchema.parse>,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ListResponse<ClientRow>> {
    const granted = caller?.permissions ?? [];
    const capabilities = {
      canEdit: hasPermission(granted, SUBJECT, "edit"),
      canDelete: hasPermission(granted, SUBJECT, "delete"),
      canApprove: false,
    };
    const filters = { siteId: query.siteId };
    const [page, total] = await Promise.all([
      this.clients.list(query, filters),
      this.clients.total(query.search, filters),
    ]);
    return { rows: page.rows.map((row) => ({ ...row, capabilities })), nextCursor: page.nextCursor, total };
  }

  @Get(":id")
  @Permissions("client.view")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<ClientDetail> {
    return this.clients.findById(id);
  }

  @Post()
  @Permissions("client.add")
  create(
    @Body(new ZodValidationPipe(createClientSchema)) body: CreateClient,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ClientDetail> {
    return this.clients.create(body, actorId(caller));
  }

  @Patch(":id")
  @Permissions("client.edit")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateClientSchema)) body: UpdateClient,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ClientDetail> {
    return this.clients.update(id, body, actorId(caller));
  }

  @Delete(":id")
  @Permissions("client.delete")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<void> {
    return this.clients.remove(id, actorId(caller));
  }
}
