import { z } from "zod";

/**
 * Environment is validated once, at startup, and the process refuses to boot if it
 * is wrong. The .NET app read `Jwt:Key` straight from configuration and handed it
 * to Encoding.UTF8.GetBytes(), so a missing key produced a NullReferenceException
 * on the first request rather than a clear failure at start.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.string().url().optional(),

  /**
   * RS256 key pair in PEM form. Asymmetric so that verifiers never hold signing
   * material — the .NET app used a symmetric HS256 key that was committed to git
   * (`appsettings.json:19`), meaning anyone with repository access could mint
   * tokens for any user.
   *
   * Optional in development only, where an ephemeral pair is generated at boot.
   */
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  JWT_ISSUER: z.string().default("accountmanagement"),
  JWT_AUDIENCE: z.string().default("accountmanagement"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const env = parsed.data;
  if (env.NODE_ENV === "production" && (!env.JWT_PRIVATE_KEY || !env.JWT_PUBLIC_KEY)) {
    throw new Error(
      "Invalid environment configuration:\n" +
        "  JWT_PRIVATE_KEY and JWT_PUBLIC_KEY are required when NODE_ENV=production.\n" +
        "  Generate a pair with: npm run --workspace @accountmanagement/api keygen",
    );
  }

  return env;
}

export const ENV = Symbol("ENV");
