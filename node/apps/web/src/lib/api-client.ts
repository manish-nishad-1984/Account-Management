import { z } from "zod";

/**
 * Typed fetch wrapper.
 *
 * Every response is parsed with the shared Zod schema from
 * `@accountmanagement/contracts`, so a server that changes shape fails loudly here
 * rather than producing `undefined` three components deep.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues?: Array<{ path: string; message: string }>,
    /**
     * The problem body as it arrived.
     *
     * Most failures are a sentence and, at most, a list of field issues. A few
     * carry a structured result the screen renders instead — the spreadsheet
     * import answers 400 with every bad row and its number, which is the point
     * of that response rather than a detail of it. Keeping the raw body means
     * such an endpoint needs no second error channel: the screen parses what it
     * expects, and everything else still gets the sentence.
     */
    readonly body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE = "/api/v1";

/** The Authorization header, or none — always an object, never a Content-Type. */
const bearer = (token: string | null): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : {};

/** Set by AuthContext. Held in memory only — never localStorage. */
let accessTokenProvider: () => string | null = () => null;
export const setAccessTokenProvider = (provider: () => string | null) => {
  accessTokenProvider = provider;
};

/**
 * Set by AuthContext: trades the refresh cookie for a new access token, or
 * answers null when there is no session left to renew.
 */
let sessionRenewer: (() => Promise<string | null>) | null = null;
export const setSessionRenewer = (renew: (() => Promise<string | null>) | null) => {
  sessionRenewer = renew;
};

/**
 * One request, and — when the access token has expired under it — the same
 * request once more with a renewed one.
 *
 * THE BUG THIS FIXES (18 Sep 2026): the access token lives 15 minutes, and the
 * app only ever renewed it on a page load. Someone working steadily was signed
 * out mid-task every 15 minutes: the next save answered 401, and the screen
 * said the session had ended while they were using it. Now a 401 renews the
 * token and repeats the request, and the person never sees it.
 *
 * NOT FOR THE AUTH ROUTES THEMSELVES: a 401 from `/auth/login` is a wrong
 * password and from `/auth/refresh` is a session that is over — renewing in
 * answer to either would loop. Only ONE retry: a second 401 is a real refusal.
 */
async function authorisedFetch(path: string, build: (token: string | null) => RequestInit): Promise<Response> {
  const response = await fetch(`${BASE}${path}`, build(accessTokenProvider()));
  if (response.status !== 401 || path.startsWith("/auth/") || !sessionRenewer) {
    return response;
  }
  const renewed = await sessionRenewer();
  return renewed ? fetch(`${BASE}${path}`, build(renewed)) : response;
}

interface RequestOptions<T> {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  schema: z.ZodType<T>;
  signal?: AbortSignal;
}

async function send(
  path: string,
  init: { method: string; body?: unknown; signal?: AbortSignal },
): Promise<Response> {
  const payload = init.body ? JSON.stringify(init.body) : undefined;
  const response = await authorisedFetch(path, (token) => ({
    method: init.method,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    /**
     * So the refresh-token cookie is sent. `fetch` omits cookies by default on
     * a cross-origin request and, historically, needed asking even same-origin —
     * and without this `/auth/refresh` sees no cookie and every page load lands
     * on the login screen. The cookie is scoped to `/api/v1/auth`, so this
     * attaches nothing to the other requests.
     */
    credentials: "same-origin",
    body: payload,
    signal: init.signal,
  }));

  if (!response.ok) {
    throw await problemFrom(response);
  }

  return response;
}

/** The one place a failed response becomes an ApiError, shared by all four helpers. */
async function problemFrom(response: Response): Promise<ApiError> {
  const problem = await response.json().catch(() => ({}) as Record<string, unknown>);
  return new ApiError(
    response.status,
    typeof problem.message === "string" ? problem.message : response.statusText,
    Array.isArray(problem.issues) ? problem.issues : undefined,
    problem,
  );
}

export async function apiRequest<T>(path: string, options: RequestOptions<T>): Promise<T> {
  const response = await send(path, {
    method: options.method ?? "GET",
    body: options.body,
    signal: options.signal,
  });

  if (response.status === 204) {
    return options.schema.parse(undefined);
  }

  return options.schema.parse(await response.json());
}

/**
 * A multipart upload.
 *
 * Separate from `send` because the Content-Type MUST NOT be set here: the
 * browser writes it itself, including the boundary parameter it generated, and
 * a hand-set `multipart/form-data` carries no boundary — the server then cannot
 * tell where one part ends and the next begins, and rejects the whole request.
 * That is the most common way an upload fails for reasons that look like a
 * server bug.
 */
export async function uploadRequest<T>(
  path: string,
  files: File[],
  options: { schema: z.ZodType<T>; signal?: AbortSignal },
): Promise<T> {
  const form = new FormData();
  for (const file of files) {
    form.append("files", file);
  }

  // The same FormData can be sent twice: it is read afresh for each request.
  const response = await authorisedFetch(path, (token) => ({
    method: "POST",
    headers: bearer(token),
    body: form,
    signal: options.signal,
  }));

  if (!response.ok) {
    throw await problemFrom(response);
  }

  return options.schema.parse(await response.json());
}

/**
 * Fetches the bytes of a file.
 *
 * A plain anchor cannot be used for a download here. The access token is held in
 * memory and never in a cookie, so a browser-initiated navigation carries no
 * credentials at all and the server answers 401. The bytes have to come back
 * through `fetch`, with the header attached, and reach the disk as an object
 * URL.
 *
 * That is a direct consequence of the token decision, and it is the right way
 * round: the alternative is a cookie the browser attaches to every request,
 * which is what makes CSRF possible.
 */
export async function downloadRequest(path: string): Promise<Blob> {
  const response = await authorisedFetch(path, (token) => ({
    headers: bearer(token),
  }));

  if (!response.ok) {
    throw await problemFrom(response);
  }

  return response.blob();
}

/**
 * A DELETE, which answers 204 with no body.
 *
 * Separate from `apiRequest` because that helper's schema is mandatory, and
 * making every delete pass `z.void()` to describe "there is nothing here" is
 * ceremony that hides what the call does. The error handling is shared.
 */
export async function deleteRequest(path: string): Promise<void> {
  await send(path, { method: "DELETE" });
}
