import { Module } from "@nestjs/common";
import { UsersController } from "./users.controller";
import { UsersRepository } from "./users.repository";
import { UserPermissionsRepository } from "./user-permissions.repository";
import { AuthModule } from "../auth/auth.module";

/**
 * AuthModule is imported for PasswordService: creating a user and resetting a
 * password both hash with argon2id, and there must be exactly one place that
 * knows the parameters. A second copy would drift from the login path's, and the
 * two would only disagree at the moment someone could not sign in.
 */
@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersRepository, UserPermissionsRepository],
})
export class UsersModule {}
