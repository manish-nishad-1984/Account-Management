import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  UnauthorizedException,
} from "@nestjs/common";
import {
  gridKeySchema,
  saveGridPreferenceSchema,
  type GridPreference,
  type GridPreferencesResponse,
} from "@accountmanagement/contracts";
import { GridPreferencesRepository } from "./grid-preferences.repository";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodBody } from "../../common/zod-validation.pipe";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import type { AccessTokenClaims } from "../auth/token.service";

/**
 * A person's own column layouts.
 *
 * NO `@Permissions` ON ANY ROUTE, and that is deliberate rather than an omission.
 * These rows carry no business data — they say which columns someone likes to
 * look at — and every route acts on the caller's own id, taken from the access
 * token and never from the path or body. There is no grid whose layout is worth
 * protecting from the person who reads that grid, and inventing a right for it
 * would mean a new form row, a new subject, and one more thing that can be
 * granted wrongly.
 *
 * The routes are still authenticated: `AuthGuard` is global and nothing here is
 * `@Public()`.
 */
@Controller("grid-preferences")
export class GridPreferencesController {
  constructor(private readonly preferences: GridPreferencesRepository) {}

  /** The caller's id, or a refusal. Never a value from the request. */
  private actor(caller: AccessTokenClaims | undefined): string {
    if (!caller?.sub) throw new UnauthorizedException();
    return caller.sub;
  }

  @Get()
  async list(
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<GridPreferencesResponse> {
    return { rows: await this.preferences.list(this.actor(caller)) };
  }

  @Put(":gridKey")
  async save(
    @Param("gridKey", new ZodValidationPipe(gridKeySchema)) gridKey: string,
    @ZodBody(saveGridPreferenceSchema) body: { columns: GridPreference["columns"] },
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<GridPreference> {
    return this.preferences.save(this.actor(caller), gridKey, body.columns);
  }

  /** Reset to the grid's defaults. Deleting the row IS the reset — see the repository. */
  @Delete(":gridKey")
  @HttpCode(204)
  async remove(
    @Param("gridKey", new ZodValidationPipe(gridKeySchema)) gridKey: string,
    @CurrentUser() caller: AccessTokenClaims | undefined,
  ): Promise<void> {
    await this.preferences.remove(this.actor(caller), gridKey);
  }
}
