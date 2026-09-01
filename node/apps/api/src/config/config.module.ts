import { Global, Module } from "@nestjs/common";
import { ENV, loadEnv } from "./env";

/**
 * Global so that every module can inject ENV without importing this one.
 *
 * Without @Global, ENV was provided in AppModule and invisible to AuthModule, and
 * the app failed to boot with UnknownDependenciesException — while every unit test
 * still passed, because tests wire their own providers. That is exactly the class
 * of gap an e2e boot check catches and unit tests do not.
 */
@Global()
@Module({
  providers: [{ provide: ENV, useValue: loadEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
