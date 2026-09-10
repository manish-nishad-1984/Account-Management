import type { FastifyReply, FastifyRequest } from "fastify";
import type { Env } from "../../config/env";

/**
 * The refresh-token cookie.
 *
 * WHY A COOKIE AT ALL. The refresh token used to be returned in the login
 * response body and held in a JavaScript variable in the browser. That meant a
 * 30-day credential was readable by any script on the page, and — because
 * nothing persisted it — every page reload dropped the session and sent the user
 * back to the login screen. A cookie fixes both: the browser keeps it across
 * reloads, and `httpOnly` puts it out of JavaScript's reach.
 *
 * The attributes are the whole security of this, so each one is deliberate:
 *
 *  - `httpOnly` — script cannot read it, so an XSS bug cannot walk off with a
 *    month of access.
 *  - `sameSite: "lax"` — the browser will not attach it to a cross-site POST,
 *    which is what makes `/auth/refresh` and `/auth/logout` safe from CSRF
 *    without a separate token. The app and the API are the same origin
 *    (`avfast.in` serves both, with nginx proxying `/api/`), so nothing
 *    legitimate is cross-site.
 *  - `path` — scoped to the auth routes, so it is not attached to the hundreds
 *    of ordinary API calls that have no use for it.
 *  - `secure` — set OUTSIDE development only. A `Secure` cookie is not sent over
 *    plain HTTP, and the dev server runs on `http://localhost:5180`; forcing it
 *    everywhere would silently break local sign-in, which is exactly the kind of
 *    failure that gets "fixed" by weakening it in production.
 *  - `maxAge` — the refresh token's own lifetime, so the cookie and the row in
 *    `refresh_tokens` expire together rather than the browser holding a token
 *    the server has already stopped honouring.
 *
 * The value is an opaque random token, not a JWT: the server hashes it and looks
 * it up, so nothing is trusted from the cookie itself.
 */
export const REFRESH_COOKIE = "ab_refresh";

/** Must match the global prefix in `bootstrap.ts` plus the controller's route. */
export const REFRESH_COOKIE_PATH = "/api/v1/auth";

/**
 * A companion cookie that says only "a session may exist here". It carries NO
 * secret — the value is the literal "1".
 *
 * It exists because the real cookie is `httpOnly`, so the browser application
 * cannot tell whether it has one. Without a hint the app must POST
 * `/auth/refresh` on every single page load just to find out, which means every
 * first-time visitor and every signed-out reader pays a pointless round trip
 * that answers 401.
 *
 * So this one is deliberately readable by script, is scoped to the whole site
 * rather than the auth routes, and is set and cleared in lockstep with the real
 * one. Being wrong about it is cheap in both directions: a stale hint costs one
 * failed refresh, and a missing hint shows the login page to someone whose
 * cookie would have worked.
 */
export const SESSION_HINT_COOKIE = "ab_session";

function options(env: Env) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.NODE_ENV !== "development",
    path: REFRESH_COOKIE_PATH,
  };
}

/** The hint's attributes: readable by script, site-wide, same lifetime. */
function hintOptions(env: Env) {
  return {
    httpOnly: false,
    sameSite: "lax" as const,
    secure: env.NODE_ENV !== "development",
    path: "/",
  };
}

export function setRefreshCookie(reply: FastifyReply, env: Env, token: string): void {
  const maxAge = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;
  reply.setCookie(REFRESH_COOKIE, token, { ...options(env), maxAge });
  reply.setCookie(SESSION_HINT_COOKIE, "1", { ...hintOptions(env), maxAge });
}

/**
 * Clears it by name AND with the same attributes. A cookie is identified by
 * name, domain and path, so clearing it without the matching `path` leaves the
 * original in place and the user stays signed in after pressing Sign out.
 */
export function clearRefreshCookie(reply: FastifyReply, env: Env): void {
  reply.clearCookie(REFRESH_COOKIE, options(env));
  // In lockstep, or the app keeps asking for a session that is gone.
  reply.clearCookie(SESSION_HINT_COOKIE, hintOptions(env));
}

/**
 * The cookie first, the body second.
 *
 * The body is still accepted so a non-browser caller — a script, a test — can
 * present the token directly. A browser never needs it, and the login response
 * no longer contains one to send.
 */
export function readRefreshToken(
  request: FastifyRequest,
  body: { refreshToken?: string } | undefined,
): string | undefined {
  return request.cookies?.[REFRESH_COOKIE] ?? body?.refreshToken;
}
