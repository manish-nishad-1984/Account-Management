import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { AuthenticatedRequest } from "./auth.guard";
import type { AccessTokenClaims } from "../../modules/auth/token.service";

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AccessTokenClaims | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
