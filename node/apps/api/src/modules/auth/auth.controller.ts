import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { z } from "zod";
import { AuthService } from "./auth.service";
import { Public } from "../../common/auth/public.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodBody } from "../../common/zod-validation.pipe";
import type { AccessTokenClaims } from "./token.service";

const loginSchema = z.object({
  userName: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(@ZodBody(loginSchema) body: z.infer<typeof loginSchema>) {
    return this.auth.login(body.userName, body.password);
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  async refresh(@ZodBody(refreshSchema) body: z.infer<typeof refreshSchema>) {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @Post("logout")
  @HttpCode(204)
  async logout(@ZodBody(refreshSchema) body: z.infer<typeof refreshSchema>): Promise<void> {
    await this.auth.logout(body.refreshToken);
  }

  /**
   * Requires a valid token. Returns the caller's own identity and nothing else —
   * in particular no credential, which is what GetUserById leaked (finding C-2).
   */
  @Get("me")
  me(@CurrentUser() user: AccessTokenClaims | undefined) {
    return {
      id: user?.sub,
      permissions: user?.permissions ?? [],
      siteIds: user?.siteIds ?? [],
      companyIds: user?.companyIds ?? [],
    };
  }
}
