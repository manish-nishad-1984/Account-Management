import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH, SESSION_HINT_COOKIE } from "./refresh-cookie";
import { configureApp } from "../../bootstrap";
import { ENV } from "../../config/env";

/**
 * THE REFRESH COOKIE, over real HTTP.
 *
 * This is the layer the reported bug lived in: every page reload landed on the
 * login screen, because the only copy of the refresh token was a JavaScript
 * variable that a reload threw away. Nothing below can be asserted from a unit
 * test of the service — it is all in what the response headers say — so this
 * boots Fastify and reads the wire.
 */

const USER = { id: "u1", userName: "tester", permissions: [] };

/** A minimal env, shaped like the real one for the fields the cookie uses. */
const env = (nodeEnv: string) => ({ NODE_ENV: nodeEnv, REFRESH_TOKEN_TTL_DAYS: 30 });

async function boot(nodeEnv = "production") {
  const auth = {
    login: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      { provide: AuthService, useValue: auth },
      { provide: ENV, useValue: env(nodeEnv) },
    ],
  }).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, auth };
}

/** The one Set-Cookie header for our cookie, whatever else is on the response. */
function cookieHeader(response: request.Response, name: string): string | undefined {
  const raw = response.headers["set-cookie"];
  const all = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return all.find((c) => c.startsWith(`${name}=`));
}

const refreshCookieHeader = (r: request.Response) => cookieHeader(r, REFRESH_COOKIE);
const hintCookieHeader = (r: request.Response) => cookieHeader(r, SESSION_HINT_COOKIE);

describe("the refresh-token cookie", () => {
  let app: NestFastifyApplication;
  let auth: { login: ReturnType<typeof vi.fn>; refresh: ReturnType<typeof vi.fn>; logout: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    process.env.LOG_LEVEL = "silent";
    ({ app, auth } = await boot());
  });

  afterEach(async () => {
    await app.close();
  });

  describe("login", () => {
    beforeEach(() => {
      auth.login.mockResolvedValue({
        accessToken: "access-1",
        refreshToken: "refresh-1",
        user: USER,
      });
    });

    it("sets the refresh token as a cookie", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ userName: "tester", password: "pw" });

      expect(response.status).toBe(200);
      expect(refreshCookieHeader(response)).toContain(`${REFRESH_COOKIE}=refresh-1`);
    });

    /**
     * The point of the cookie. If the token is also in the JSON, script on the
     * page can still read a 30-day credential and `httpOnly` has bought nothing.
     */
    it("does NOT return the refresh token in the body", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ userName: "tester", password: "pw" });

      expect(response.body.accessToken).toBe("access-1");
      expect(response.body.user).toEqual(USER);
      expect(response.body).not.toHaveProperty("refreshToken");
    });

    it("marks the cookie HttpOnly, SameSite=Lax and scoped to the auth routes", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ userName: "tester", password: "pw" });

      const cookie = refreshCookieHeader(response) ?? "";
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain(`Path=${REFRESH_COOKIE_PATH}`);
      // 30 days, so the cookie and the stored token expire together.
      expect(cookie).toContain(`Max-Age=${30 * 24 * 60 * 60}`);
    });

    it("marks it Secure outside development", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ userName: "tester", password: "pw" });

      expect(refreshCookieHeader(response)).toContain("Secure");
    });

    /**
     * A `Secure` cookie is not sent over plain HTTP, and the dev server is
     * http://localhost. Setting it there would break local sign-in, and the
     * usual "fix" for that is to weaken it everywhere.
     */
    it("does NOT mark it Secure in development", async () => {
      await app.close();
      ({ app, auth } = await boot("development"));
      auth.login.mockResolvedValue({
        accessToken: "access-1",
        refreshToken: "refresh-1",
        user: USER,
      });

      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ userName: "tester", password: "pw" });

      expect(refreshCookieHeader(response)).not.toContain("Secure");
    });
  });

  describe("refresh", () => {
    it("reads the token from the cookie, with no body to help it", async () => {
      auth.refresh.mockResolvedValue({
        accessToken: "access-2",
        refreshToken: "refresh-2",
        user: USER,
      });

      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .set("Cookie", `${REFRESH_COOKIE}=refresh-1`)
        .send({});

      expect(response.status).toBe(200);
      expect(auth.refresh).toHaveBeenCalledWith("refresh-1");
      expect(response.body.accessToken).toBe("access-2");
    });

    /**
     * The service spends the presented token on every use. If the reply did not
     * carry the replacement, the browser would keep the spent one and the NEXT
     * reload would fail — the original bug, one reload later.
     */
    it("replaces the cookie, because the token rotates", async () => {
      auth.refresh.mockResolvedValue({
        accessToken: "access-2",
        refreshToken: "refresh-2",
        user: USER,
      });

      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .set("Cookie", `${REFRESH_COOKIE}=refresh-1`)
        .send({});

      expect(refreshCookieHeader(response)).toContain(`${REFRESH_COOKIE}=refresh-2`);
    });

    it("401s when there is no cookie, without calling the service", async () => {
      const response = await request(app.getHttpServer()).post("/api/v1/auth/refresh").send({});

      expect(response.status).toBe(401);
      expect(auth.refresh).not.toHaveBeenCalled();
    });

    /**
     * A cookie the server will never accept again must not survive the answer,
     * or every load repeats the same doomed round trip.
     */
    it("clears the cookie when the token is rejected", async () => {
      auth.refresh.mockRejectedValue(new Error("spent"));

      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .set("Cookie", `${REFRESH_COOKIE}=stale`)
        .send({});

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(refreshCookieHeader(response)).toContain(`${REFRESH_COOKIE}=;`);
    });

    /** A script or a test has no cookie jar; the body still works for them. */
    it("still accepts a token in the body", async () => {
      auth.refresh.mockResolvedValue({
        accessToken: "access-2",
        refreshToken: "refresh-2",
        user: USER,
      });

      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: "from-body" });

      expect(response.status).toBe(200);
      expect(auth.refresh).toHaveBeenCalledWith("from-body");
    });
  });

  describe("logout", () => {
    it("revokes the cookie's token and clears the cookie", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/logout")
        .set("Cookie", `${REFRESH_COOKIE}=refresh-1`)
        .send({});

      expect(response.status).toBe(204);
      expect(auth.logout).toHaveBeenCalledWith("refresh-1");
      expect(refreshCookieHeader(response)).toContain(`${REFRESH_COOKIE}=;`);
    });

    /**
     * Clearing has to name the same Path. A cookie is identified by name, domain
     * and path, so a mismatched clear leaves the original in place and Sign out
     * silently does nothing.
     */
    it("clears it on the same path it was set on", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/logout")
        .set("Cookie", `${REFRESH_COOKIE}=refresh-1`)
        .send({});

      expect(refreshCookieHeader(response)).toContain(`Path=${REFRESH_COOKIE_PATH}`);
    });

    it("still clears the cookie when no token was presented", async () => {
      const response = await request(app.getHttpServer()).post("/api/v1/auth/logout").send({});

      expect(response.status).toBe(204);
      expect(auth.logout).not.toHaveBeenCalled();
      expect(refreshCookieHeader(response)).toContain(`${REFRESH_COOKIE}=;`);
    });
  });

  /**
   * The hint tells the browser application that a session MAY exist, so it only
   * asks the server when there is something to ask about. Without it every visit
   * to the login page by a signed-out reader costs a round trip that answers 401.
   */
  describe("the session hint", () => {
    beforeEach(() => {
      auth.login.mockResolvedValue({
        accessToken: "access-1",
        refreshToken: "refresh-1",
        user: USER,
      });
    });

    it("is set beside the real cookie on login", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ userName: "tester", password: "pw" });

      expect(hintCookieHeader(response)).toContain(`${SESSION_HINT_COOKIE}=1`);
    });

    /** It has to be readable by script — that is its entire job. */
    it("is NOT HttpOnly, and is scoped to the whole site", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ userName: "tester", password: "pw" });

      const cookie = hintCookieHeader(response) ?? "";
      expect(cookie).not.toContain("HttpOnly");
      expect(cookie).toContain("Path=/");
    });

    /** It carries no secret, and must never be mistaken for one. */
    it("never contains the refresh token", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ userName: "tester", password: "pw" });

      expect(hintCookieHeader(response)).not.toContain("refresh-1");
    });

    it("is cleared on logout, so the app stops asking", async () => {
      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/logout")
        .set("Cookie", `${REFRESH_COOKIE}=refresh-1`)
        .send({});

      expect(hintCookieHeader(response)).toContain(`${SESSION_HINT_COOKIE}=;`);
    });

    it("is cleared when a refresh is rejected", async () => {
      auth.refresh.mockRejectedValue(new Error("spent"));

      const response = await request(app.getHttpServer())
        .post("/api/v1/auth/refresh")
        .set("Cookie", `${REFRESH_COOKIE}=stale`)
        .send({});

      expect(hintCookieHeader(response)).toContain(`${SESSION_HINT_COOKIE}=;`);
    });
  });
});
