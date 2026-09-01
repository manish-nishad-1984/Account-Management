import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { DevSeed } from "./dev-seed";
import { DrizzleUserRepository } from "./drizzle-user.repository";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";
import { InMemoryUserRepository, UserRepository } from "./user.repository";
import { DATABASE, type Database } from "../../db/database";

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    DevSeed,
    {
      provide: UserRepository,
      inject: [DATABASE],
      useFactory: (db: Database | null) =>
        db ? new DrizzleUserRepository(db) : new InMemoryUserRepository(),
    },
  ],
  exports: [TokenService, AuthService, PasswordService, UserRepository],
})
export class AuthModule {}
