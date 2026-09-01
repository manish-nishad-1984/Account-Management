import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { TokenService, type AccessTokenClaims } from "../../modules/auth/token.service";

export interface AuthenticatedRequest {
  headers: Record<string, unknown>;
  user?: AccessTokenClaims;
}

/**
 * Global, default-deny authentication.
 *
 * Registered as APP_GUARD, so forgetting a decorator produces a 401 rather than an
 * open endpoint — the inverse of the .NET model, where `[Authorize]` was optional
 * and FormPermissionMasterController did without it (finding C-6).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers["authorization"];
    if (typeof header !== "string" || !header.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }

    try {
      request.user = await this.tokens.verifyAccessToken(header.slice("Bearer ".length));
    } catch {
      // Never echo the underlying reason — expired, wrong audience and bad
      // signature must be indistinguishable to a caller.
      throw new UnauthorizedException("Invalid token");
    }

    return true;
  }
}
