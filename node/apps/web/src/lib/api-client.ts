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

/** The one place a failed response becomes an ApiError, shared by both helpers. */
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
    const problem = await response.json().catch(() => ({}) as Record<string, unknown>);
    throw new ApiError(
      response.status,
      typeof problem.message === "string" ? problem.message : response.statusText,
      Array.isArray(problem.issues) ? problem.issues : undefined,
    );
  }

  return response;
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
 * A DELETE, which answers 204 with no body.
 *
 * Separate from `apiRequest` because that helper's schema is mandatory, and
 * making every delete pass `z.void()` to describe "there is nothing here" is
 * ceremony that hides what the call does. The error handling is shared.
 */
export async function deleteRequest(path: string): Promise<void> {
  await send(path, { method: "DELETE" });
}
