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
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE = "/api/v1";

/** Set by AuthContext. Held in memory only — never localStorage. */
let accessTokenProvider: () => string | null = () => null;
export const setAccessTokenProvider = (provider: () => string | null) => {
  accessTokenProvider = provider;
};

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
  const token = accessTokenProvider();
  const response = await fetch(`${BASE}${path}`, {
    method: init.method,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  });

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

  const token = accessTokenProvider();
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
    signal: options.signal,
  });

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
  const token = accessTokenProvider();
  const response = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

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
