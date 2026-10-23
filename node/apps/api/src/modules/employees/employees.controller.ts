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
  createEmployeeSchema,
  hasPermission,
  listQuerySchema,
  updateEmployeeSchema,
  type CreateEmployee,
  type EmployeeDetail,
  type EmployeeRow,
  type ListResponse,
  type UpdateEmployee,
} from "@accountmanagement/contracts";
import { EmployeesRepository } from "./employees.repository";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { actorId } from "../../common/actor";
import type { AccessTokenClaims } from "../auth/token.service";

/** Subject `employee`, from the form row "Employee" that migration 0033 inserts. */
const SUBJECT = "employee";

const listRequestSchema = listQuerySchema.and(
  z.object({
    companyId: z.string().uuid().optional(),
    active: z.enum(["true", "false"]).optional(),
  }),
);

@Controller("employees")
export class EmployeesController {
  constructor(private readonly employees: EmployeesRepository) {}

  @Get()
  @Permissions("employee.view")
  async list(
    @Query(new ZodValidationPipe(listRequestSchema)) query: ReturnType<typeof listRequestSchema.parse>,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<ListResponse<EmployeeRow>> {
    const granted = caller?.permissions ?? [];
    const capabilities = {
      canEdit: hasPermission(granted, SUBJECT, "edit"),
      canDelete: hasPermission(granted, SUBJECT, "delete"),
      canApprove: false,
    };
    const filters = { companyId: query.companyId, active: query.active === undefined ? undefined : query.active === "true" };
    const [page, total] = await Promise.all([
      this.employees.list(query, filters),
      this.employees.total(query.search, filters),
    ]);
    return { rows: page.rows.map((row) => ({ ...row, capabilities })), nextCursor: page.nextCursor, total };
  }

  @Get(":id")
  @Permissions("employee.view")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<EmployeeDetail> {
    return this.employees.findById(id);
  }

  @Post()
  @Permissions("employee.add")
  create(
    @Body(new ZodValidationPipe(createEmployeeSchema)) body: CreateEmployee,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<EmployeeDetail> {
    return this.employees.create(body, actorId(caller));
  }

  /** The whole employee, additions and deductions included, as the form sends it. */
  @Patch(":id")
  @Permissions("employee.edit")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateEmployeeSchema)) body: UpdateEmployee,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<EmployeeDetail> {
    return this.employees.update(id, body, actorId(caller));
  }

  @Delete(":id")
  @Permissions("employee.delete")
  @HttpCode(204)
  remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<void> {
    return this.employees.remove(id, actorId(caller));
  }
}
