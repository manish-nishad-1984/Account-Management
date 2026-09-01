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
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  schema: z.ZodType<T>;
  signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, options: RequestOptions<T>): Promise<T> {
  const token = accessTokenProvider();
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  if (!response.ok) {
    const problem = await response.json().catch(() => ({}) as Record<string, unknown>);
    throw new ApiError(
      response.status,
      typeof problem.message === "string" ? problem.message : response.statusText,
      Array.isArray(problem.issues) ? problem.issues : undefined,
    );
  }

  if (response.status === 204) {
    return options.schema.parse(undefined);
  }

  return options.schema.parse(await response.json());
}
