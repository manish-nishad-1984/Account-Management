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
  createAgencySchema,
  createWorkTypeSchema,
  hasPermission,
  listQuerySchema,
  updateAgencySchema,
  type AgencyDetail,
  type AgencyRow,
  type AgencySummary,
  type CreateAgency,
  type CreateWorkType,
  type ListResponse,
  type UpdateAgency,
  type WorkType,
} from "@accountmanagement/contracts";
import { AgenciesRepository } from "./agencies.repository";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { actorId } from "../../common/actor";
import type { AccessTokenClaims } from "../auth/token.service";

/**
 * Subject `agency`, from the form row "Agency" that migration 0021 inserts.
 * A new master with no legacy counterpart, so every route carries its right
 * from the start. There is no approval: the mockup has Active / Inactive.
 */
const SUBJECT = "agency";

/** Query strings are strings; each filter is coerced explicitly. */
const filterSchema = z.object({
  workTypeId: z.coerce.number().int().positive().optional(),
  cityId: z.coerce.number().int().positive().optional(),
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
});

const listRequestSchema = listQuerySchema.and(filterSchema);

@Controller("agencies")
export class AgenciesController {
  constructor(private readonly agencies: AgenciesRepository) {}

  @Get()
  @Permissions("agency.view")
  async list(
    @Query(new ZodValidationPipe(listRequestSchema))
    query: ReturnType<typeof listRequestSchema.parse>,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ListResponse<AgencyRow>> {
    const granted = caller?.permissions ?? [];
    const capabilities = {
      canEdit: hasPermission(granted, SUBJECT, "edit"),
      canDelete: hasPermission(granted, SUBJECT, "delete"),
      canApprove: false,
    };
    const filters = { workTypeId: query.workTypeId, cityId: query.cityId, isActive: query.isActive };

    const [page, total] = await Promise.all([
      this.agencies.list(query, filters),
      this.agencies.total(query.search, filters),
    ]);
    return { rows: page.rows.map((row) => ({ ...row, capabilities })), nextCursor: page.nextCursor, total };
  }

  /** Static segments beside `:id` — Fastify prefers them whatever the order (§5h). */
  @Get("summary")
  @Permissions("agency.view")
  summary(): Promise<AgencySummary> {
    return this.agencies.summary();
  }

  @Get("work-types")
  @Permissions("agency.view")
  workTypes(): Promise<WorkType[]> {
    return this.agencies.listWorkTypes();
  }

  /** Adding a trade from the agency form; whoever may add an agency may name its trade. */
  @Post("work-types")
  @Permissions("agency.add")
  createWorkType(
    @Body(new ZodValidationPipe(createWorkTypeSchema)) body: CreateWorkType,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<WorkType> {
    return this.agencies.createWorkType(body.name, actorId(caller));
  }

  @Get(":id")
  @Permissions("agency.view")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<AgencyDetail> {
    return this.agencies.findById(id);
  }

  @Post()
  @Permissions("agency.add")
  create(
    @Body(new ZodValidationPipe(createAgencySchema)) body: CreateAgency,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<AgencyDetail> {
    return this.agencies.create(body, actorId(caller));
  }

  @Patch(":id")
  @Permissions("agency.edit")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateAgencySchema)) body: UpdateAgency,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<AgencyDetail> {
    return this.agencies.update(id, body, actorId(caller));
  }

  @Delete(":id")
  @Permissions("agency.delete")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<void> {
    return this.agencies.remove(id, actorId(caller));
  }
}
