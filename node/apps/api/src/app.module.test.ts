import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { AppModule } from "./app.module";

/**
 * Boots the REAL module graph.
 *
 * Every unit test in this project passed while the application could not start:
 * ENV was provided in AppModule and invisible to AuthModule, so Nest threw
 * UnknownDependenciesException at boot. Unit tests wire their own providers and
 * cannot see that. This test can.
 */
describe("AppModule", () => {
  it("resolves the whole dependency graph and serves requests", async () => {
    process.env.NODE_ENV = "test";
    process.env.LOG_LEVEL = "silent";

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix("api/v1");
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    try {
      const health = await request(app.getHttpServer()).get("/api/v1/health");
      expect(health.status).toBe(200);
      expect(health.body.status).toBe("ok");

      // Default-deny is live on the real graph, not just the test harness.
      const me = await request(app.getHttpServer()).get("/api/v1/auth/me");
      expect(me.status).toBe(401);
    } finally {
      await app.close();
    }
  });
});
