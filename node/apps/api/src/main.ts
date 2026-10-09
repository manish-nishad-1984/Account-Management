import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { configureApp } from "./bootstrap";
import { loadEnv } from "./config/env";

async function bootstrap() {
  const env = loadEnv();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // 8 MB rather than Fastify's 1 MB, for the list screens' "Export to Excel":
    // the browser sends up to GRID_EXPORT_MAX_ROWS rows to be turned into a
    // file. Every other JSON body is a few KB, and attachments are multipart,
    // which has its own limit.
    new FastifyAdapter({ bodyLimit: 8 * 1024 * 1024 }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));
  await configureApp(app);

  await app.listen({ port: env.PORT, host: env.HOST });
}

void bootstrap();
