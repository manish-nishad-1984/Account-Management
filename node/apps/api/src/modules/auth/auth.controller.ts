import { Controller, Get, HttpCode, Inject, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthService } from "./auth.service";
import { Public } from "../../common/auth/public.decorator";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodBody } from "../../common/zod-validation.pipe";
import { ENV, type Env } from "../../config/env";
import { clearRefreshCookie, readRefreshToken, setRefreshCookie } from "./refresh-cookie";
import type { AccessTokenClaims } from "./token.service";

const loginSchema = z.object({
  userName: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

/**
 * Optional, because a browser sends the refresh token in its cookie and has no
 * copy to put in a body — the login response does not hand one out any more.
 */
const refreshSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

/**
 * `passthrough: true` on every `@Res()` below is load-bearing: without it Nest
 * stops serialising the return value and the route hangs. The reply is taken
 * only to set a cookie on it.
 */
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(
    @ZodBody(loginSchema) body: z.infer<typeof loginSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { refreshToken, ...result } = await this.auth.login(body.userName, body.password);
    setRefreshCookie(reply, this.env, refreshToken);
    return result;
  }

  /**
   * Called by the browser on every page load, which is the point: the access
   * token lives in memory and does not survive a reload, so this is what turns
   * the surviving cookie back into a session.
   *
   * A 401 here is the ORDINARY case for someone who is not signed in, not an
   * error worth logging loudly.
   */
  @Public()
  @Post("refresh")
  @HttpCode(200)
  async refresh(
    @ZodBody(refreshSchema) body: z.infer<typeof refreshSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const presented = readRefreshToken(request, body);
    if (!presented) {
      // No cookie and no body: nobody is signed in. Clear anything stale so a
      // corrupt cookie cannot make every load fail forever.
      clearRefreshCookie(reply, this.env);
      throw new UnauthorizedException("Invalid refresh token");
    }

    try {
      const { refreshToken, ...result } = await this.auth.refresh(presented);
      // The service ROTATES on every use — the presented token is spent — so the
      // cookie must be replaced, not left alone, or the next reload fails.
      setRefreshCookie(reply, this.env, refreshToken);
      return result;
    } catch (error) {
      clearRefreshCookie(reply, this.env);
      throw error;
    }
  }

  @Public()
  @Post("logout")
  @HttpCode(204)
  async logout(
    @ZodBody(refreshSchema) body: z.infer<typeof refreshSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const presented = readRefreshToken(request, body);
    // The cookie goes regardless of whether the token was still valid: a sign-out
    // that leaves the cookie behind is worse than one that revokes nothing.
    clearRefreshCookie(reply, this.env);
    if (presented) await this.auth.logout(presented);
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
