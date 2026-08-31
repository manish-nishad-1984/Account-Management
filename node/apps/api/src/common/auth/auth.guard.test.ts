import { Controller, Get, INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { AuthGuard } from "./auth.guard";
import { PermissionsGuard } from "./permissions.guard";
import { Public } from "./public.decorator";
import { Permissions } from "./permissions.decorator";
import { TokenService } from "../../modules/auth/token.service";
import { ENV, loadEnv, type Env } from "../../config/env";

@Controller("probe")
class ProbeController {
  @Public()
  @Get("open")
  open() {
    return { reached: true };
  }

  // Deliberately undecorated — the case that was a security hole in the .NET app.
  @Get("closed")
  closed() {
    return { reached: true };
  }

  @Get("approve")
  @Permissions("invoice.approve")
  approve() {
    return { reached: true };
  }

  @Get("multi")
  @Permissions("invoice.approve", "invoice.pay")
  multi() {
    return { reached: true };
  }
}

describe("AuthGuard + PermissionsGuard (global, default-deny)", () => {
  let app: INestApplication;
  let tokens: TokenService;
  let env: Env;

  const issue = (permissions: string[]) =>
    tokens
      .issue({ sub: "user-1", permissions, siteIds: [], companyIds: [] })
      .then((t) => t.accessToken);

  beforeAll(async () => {
    const pem = await TokenService.generatePemPair();
    env = loadEnv({
      NODE_ENV: "test",
      JWT_PRIVATE_KEY: pem.privateKey,
      JWT_PUBLIC_KEY: pem.publicKey,
    } as NodeJS.ProcessEnv);

    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [
        { provide: ENV, useValue: env },
        TokenService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    tokens = moduleRef.get(TokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe("authentication", () => {
    it("allows a route explicitly marked @Public()", async () => {
      const res = await request(app.getHttpServer()).get("/probe/open");
      expect(res.status).toBe(200);
    });

    it("REFUSES an undecorated route — forgetting the decorator fails closed", async () => {
      const res = await request(app.getHttpServer()).get("/probe/closed");
      expect(res.status).toBe(401);
    });

    it("refuses a malformed Authorization header", async () => {
      const res = await request(app.getHttpServer())
        .get("/probe/closed")
        .set("Authorization", "Basic abc123");
      expect(res.status).toBe(401);
    });

    it("refuses a garbage bearer token", async () => {
      const res = await request(app.getHttpServer())
        .get("/probe/closed")
        .set("Authorization", "Bearer not.a.token");
      expect(res.status).toBe(401);
    });

    it("accepts a validly signed token", async () => {
      const res = await request(app.getHttpServer())
        .get("/probe/closed")
        .set("Authorization", `Bearer ${await issue([])}`);
      expect(res.status).toBe(200);
    });

    it("does not leak why a token was rejected", async () => {
      const res = await request(app.getHttpServer())
        .get("/probe/closed")
        .set("Authorization", "Bearer not.a.token");
      expect(res.body.message).toBe("Invalid token");
    });
  });

  describe("authorization", () => {
    it("allows a caller holding the required permission", async () => {
      const res = await request(app.getHttpServer())
        .get("/probe/approve")
        .set("Authorization", `Bearer ${await issue(["invoice.approve"])}`);
      expect(res.status).toBe(200);
    });

    it("REFUSES an authenticated caller without the permission (403, not 401)", async () => {
      const res = await request(app.getHttpServer())
        .get("/probe/approve")
        .set("Authorization", `Bearer ${await issue(["invoice.view"])}`);
      expect(res.status).toBe(403);
    });

    it("requires every listed permission, not just one", async () => {
      const res = await request(app.getHttpServer())
        .get("/probe/multi")
        .set("Authorization", `Bearer ${await issue(["invoice.approve"])}`);
      expect(res.status).toBe(403);
      expect(res.body.message).toContain("invoice.pay");
    });

    it("allows a caller holding all listed permissions", async () => {
      const res = await request(app.getHttpServer())
        .get("/probe/multi")
        .set("Authorization", `Bearer ${await issue(["invoice.approve", "invoice.pay"])}`);
      expect(res.status).toBe(200);
    });
  });
});
