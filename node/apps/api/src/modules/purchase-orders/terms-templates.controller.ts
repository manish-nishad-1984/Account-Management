import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { saveTermsTemplateSchema, type SaveTermsTemplate, type SavedTermsTemplate } from "@accountmanagement/contracts";
import { TermsTemplatesRepository } from "./terms-templates.repository";
import { Permissions } from "../../common/auth/permissions.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { actorId } from "../../common/actor";
import type { AccessTokenClaims } from "../auth/token.service";

/**
 * Saved terms and conditions, loaded into a purchase order by name (client,
 * 22 Oct 2026). Guarded by the purchase order rights: whoever can see an order
 * can load a template, whoever can raise one can save one, and deleting one
 * needs the right to delete orders.
 */
@Controller("terms-templates")
export class TermsTemplatesController {
  constructor(private readonly templates: TermsTemplatesRepository) {}

  @Get()
  @Permissions("purchase-orders.view")
  async list(): Promise<{ rows: SavedTermsTemplate[] }> {
    return { rows: await this.templates.list() };
  }

  @Post()
  @Permissions("purchase-orders.add")
  create(
    @Body(new ZodValidationPipe(saveTermsTemplateSchema)) body: SaveTermsTemplate,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<SavedTermsTemplate> {
    return this.templates.create(body, actorId(caller));
  }

  @Patch(":id")
  @Permissions("purchase-orders.add")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(saveTermsTemplateSchema)) body: SaveTermsTemplate,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<SavedTermsTemplate> {
    return this.templates.update(id, body, actorId(caller));
  }

  @Delete(":id")
  @Permissions("purchase-orders.delete")
  @HttpCode(204)
  async remove(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    await this.templates.remove(id);
  }
}
