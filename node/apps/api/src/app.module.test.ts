import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { AppModule } from "./app.module";
import { configureApp } from "./bootstrap";

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
    // The same configuration main.ts applies. Setting the prefix by hand here
    // instead would let the two drift, and the drift would be invisible: the
    // routes would still answer, and only an upload would fail.
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    try {
      const health = await request(app.getHttpServer()).get("/api/v1/health");
      expect(health.status).toBe(200);
      expect(health.body.status).toBe("ok");

      // Default-deny is live on the real graph, not just the test harness.
      const me = await request(app.getHttpServer()).get("/api/v1/auth/me");
      expect(me.status).toBe(401);

      /**
       * The upload route exists AND multipart is registered.
       *
       * Both halves matter and only this test can see either. `configureApp`
       * registers @fastify/multipart on the adapter, which no unit test
       * exercises; without it every upload would be refused as "not multipart"
       * on a server that boots perfectly and passes every other test.
       */
      const fastify = app.getHttpAdapter().getInstance();
      expect(fastify.hasContentTypeParser("multipart/form-data")).toBe(true);

      // hasRoute rather than printRoutes: the printed tree nests segments, so a
      // substring match on the full path passes or fails for reasons that have
      // nothing to do with whether the route is there.
      expect(
        fastify.hasRoute({ method: "POST", url: "/api/v1/inward-challans/:id/documents" }),
      ).toBe(true);
      expect(
        fastify.hasRoute({
          method: "GET",
          url: "/api/v1/inward-challans/:id/documents/:documentId",
        }),
      ).toBe(true);
      expect(
        fastify.hasRoute({
          method: "DELETE",
          url: "/api/v1/inward-challans/:id/documents/:documentId",
        }),
      ).toBe(true);

      // And it is behind the guard like everything else — a file endpoint that
      // forgot its token check is how the legacy uploads became public.
      const upload = await request(app.getHttpServer())
        .post("/api/v1/inward-challans/11111111-1111-1111-1111-111111111111/documents")
        .attach("files", Buffer.from("%PDF-1.7\n"), "challan.pdf");
      expect(upload.status).toBe(401);

      const download = await request(app.getHttpServer()).get(
        "/api/v1/inward-challans/11111111-1111-1111-1111-111111111111/documents/22222222-2222-2222-2222-222222222222",
      );
      expect(download.status).toBe(401);
    } finally {
      await app.close();
    }
  });
});
