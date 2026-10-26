import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, UnauthorizedException } from "@nestjs/common";
import { saveDateTagSchema, type DateTag, type SaveDateTag } from "@accountmanagement/contracts";
import { DateTagsRepository } from "./date-tags.repository";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import type { AccessTokenClaims } from "../auth/token.service";

/**
 * A person's own date tags on the Excel Export (client, 26 Oct 2026).
 *
 * No `@Permissions`, as for the column layouts: a tag is two dates and a name,
 * no business data, and every route acts on the caller's own id from the token.
 */
@Controller("date-tags")
export class DateTagsController {
  constructor(private readonly tags: DateTagsRepository) {}

  private actor(caller: AccessTokenClaims | undefined): string {
    if (!caller?.sub) throw new UnauthorizedException();
    return caller.sub;
  }

  @Get()
  async list(@CurrentUser() caller: AccessTokenClaims | undefined): Promise<{ tags: DateTag[] }> {
    return { tags: await this.tags.list(this.actor(caller)) };
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(saveDateTagSchema)) body: SaveDateTag,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<DateTag> {
    return this.tags.create(this.actor(caller), body);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() caller: AccessTokenClaims | undefined): Promise<void> {
    return this.tags.remove(this.actor(caller), id);
  }
}
