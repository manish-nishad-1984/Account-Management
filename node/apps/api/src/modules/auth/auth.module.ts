import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";
import { InMemoryUserRepository, UserRepository } from "./user.repository";
import { DevSeed } from "./dev-seed";

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    // TODO(db): swap for the Drizzle-backed adapter once the PostgreSQL schema
    // lands. The schema is blocked on the orphan census (assessment blocker 4).
    { provide: UserRepository, useClass: InMemoryUserRepository },
    DevSeed,
  ],
  exports: [TokenService, AuthService, PasswordService, UserRepository],
})
export class AuthModule {}
