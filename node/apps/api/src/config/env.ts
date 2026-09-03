import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * The two characters backslash and n — an *escaped* newline, as opposed to a real
 * one. Built from a char code deliberately: a doubled backslash in a source
 * literal is one careless copy-paste, shell heredoc or editor away from
 * collapsing into a real newline, and when that happens the decoding below turns
 * into a silent no-op that only shows up as a 500 on the first login.
 */
const BACKSLASH = String.fromCharCode(92);
const ESCAPED_LF = BACKSLASH + "n";
const ESCAPED_CRLF = BACKSLASH + "r" + BACKSLASH + "n";

/**
 * A PEM carried in an environment variable arrives with its newlines either real
 * (a shell heredoc, a docker-compose block) or escaped (most CI secret stores,
 * anything modelled on a GCP service-account key). Accept both.
 */
function normalisePem(value: string): string {
  return value
    .trim()
    .split(ESCAPED_CRLF)
    .join("\n")
    .split(ESCAPED_LF)
    .join("\n")
    // a genuine CRLF, from a file written on Windows
    .split("\r\n")
    .join("\n");
}

const pem = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }
  const text = normalisePem(value);
  return text === "" ? undefined : text;
}, z.string().optional());

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional(),
);

/**
 * Environment is validated once, at startup, and the process refuses to boot if it
 * is wrong. The .NET app read `Jwt:Key` straight from configuration and handed it
 * to Encoding.UTF8.GetBytes(), so a missing key produced a NullReferenceException
 * on the first request rather than a clear failure at start.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  /**
   * Bind address. Defaults to 0.0.0.0 so a container is reachable from outside
   * itself. Behind a reverse proxy set it to 127.0.0.1 — otherwise the API is
   * also reachable DIRECTLY on its port, bypassing the proxy and whatever the
   * proxy is there to enforce.
   */
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  // An unset variable and one set to "" mean the same thing to a deployment
  // script, so treat them the same rather than failing .url() on empty.
  DATABASE_URL: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().url().optional(),
  ),

  /**
   * Path to a JSON snapshot of REAL master data, produced by
   * `tools/import-masters` (`--snapshot`). When set, development seeds from it
   * instead of generating the dummy masters, so the app can be exercised against
   * real records without a PostgreSQL server or its credentials.
   *
   * Development only, and ignored in production.
   */
  SEED_SNAPSHOT: optionalString,

  /**
   * RS256 key pair in PEM form. Asymmetric so that verifiers never hold signing
   * material — the .NET app used a symmetric HS256 key that was committed to git
   * (`appsettings.json:19`), meaning anyone with repository access could mint
   * tokens for any user.
   *
   * Optional in development only, where an ephemeral pair is generated at boot.
   */
  JWT_PRIVATE_KEY: pem,
  JWT_PUBLIC_KEY: pem,

  /**
   * Preferred over the two inline variables above: a path to the PEM file.
   *
   * A multi-line PEM cannot survive systemd. `EnvironmentFile` reads one line
   * per variable, so real newlines truncate the value to its BEGIN line; and in
   * an UNQUOTED value systemd treats a backslash as an escape and removes it, so
   * escaping the newlines instead yields BEGIN...KEY-----nMIIEv... with no line
   * breaks at all. Both reach jose as an opaque "asn1 encoding routines" error
   * on the first login rather than as a failure at boot.
   *
   * Reading the file sidesteps every layer of that, and keeps the signing key
   * out of the process environment, where it is otherwise readable by anything
   * that can open /proc/<pid>/environ.
   */
  JWT_PRIVATE_KEY_FILE: optionalString,
  JWT_PUBLIC_KEY_FILE: optionalString,

  JWT_ISSUER: z.string().default("accountmanagement"),
  JWT_AUDIENCE: z.string().default("accountmanagement"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Reject a PEM that cannot possibly be imported, while there is still a useful
 * place to say so. jose's own error arrives on the first login instead, names
 * neither the variable nor the cause, and reaches the user as a bare 500.
 *
 * This is a shape check, not cryptographic validation — a well-formed key that
 * is simply the wrong key still fails later, and should.
 */
function assertUsablePem(variable: string, value: string, label: "PRIVATE KEY" | "PUBLIC KEY") {
  const begin = "-----BEGIN " + label + "-----";
  const end = "-----END " + label + "-----";

  if (!value.includes(begin) || !value.includes(end)) {
    const truncated = value.includes(begin) && !value.includes(end);
    throw new Error(
      "Invalid environment configuration:\n" +
        `  ${variable} is not a complete PEM — expected ${begin} ... ${end}.\n` +
        (truncated
          ? "  It has the BEGIN line but no END line, which is exactly what a multi-line\n" +
            "  PEM looks like after systemd EnvironmentFile has read only its first line.\n"
          : `  Got: ${JSON.stringify(value.slice(0, 40))}...\n`) +
        `  Use ${variable}_FILE with a path to the .pem instead.`,
    );
  }

  // Base64 body between the markers. A real RS256 key runs to hundreds of
  // characters; anything shorter is a fragment, not a key.
  const body = value.slice(value.indexOf(begin) + begin.length, value.indexOf(end));
  const material = body.replace(/\s/g, "").length;
  if (material < 100) {
    throw new Error(
      "Invalid environment configuration:\n" +
        `  ${variable} has PEM markers but only ${material} characters of key ` +
        "material between them. It is truncated.",
    );
  }

  // The markers can survive while the line breaks do not — precisely what
  // systemd does to an escaped newline in an unquoted value. jose then fails
  // with "asn1 encoding routines::too long".
  if (!body.includes("\n")) {
    throw new Error(
      "Invalid environment configuration:\n" +
        `  ${variable} has no line breaks in its key material, so it cannot be\n` +
        "  decoded. systemd removes the backslash from an escaped newline in an\n" +
        `  unquoted EnvironmentFile value. Use ${variable}_FILE with a path instead.`,
    );
  }
}

/** A `*_FILE` variable wins over its inline counterpart when both are set. */
function resolveKey(
  variable: "JWT_PRIVATE_KEY" | "JWT_PUBLIC_KEY",
  file: string | undefined,
  inline: string | undefined,
): string | undefined {
  if (!file) {
    return inline;
  }
  let contents: string;
  try {
    contents = readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(
      "Invalid environment configuration:\n" +
        `  ${variable}_FILE is ${file}, which could not be read: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return normalisePem(contents) || undefined;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const env: Env = {
    ...parsed.data,
    JWT_PRIVATE_KEY: resolveKey(
      "JWT_PRIVATE_KEY",
      parsed.data.JWT_PRIVATE_KEY_FILE,
      parsed.data.JWT_PRIVATE_KEY,
    ),
    JWT_PUBLIC_KEY: resolveKey(
      "JWT_PUBLIC_KEY",
      parsed.data.JWT_PUBLIC_KEY_FILE,
      parsed.data.JWT_PUBLIC_KEY,
    ),
  };

  if (env.NODE_ENV === "production" && !env.DATABASE_URL) {
    throw new Error(
      "Invalid environment configuration:\n" +
        "  DATABASE_URL is required when NODE_ENV=production. Without it the API " +
        "would silently fall back to the in-memory repository and lose every write.",
    );
  }

  if (env.NODE_ENV === "production" && (!env.JWT_PRIVATE_KEY || !env.JWT_PUBLIC_KEY)) {
    throw new Error(
      "Invalid environment configuration:\n" +
        "  JWT_PRIVATE_KEY and JWT_PUBLIC_KEY are required when NODE_ENV=production\n" +
        "  (or JWT_PRIVATE_KEY_FILE / JWT_PUBLIC_KEY_FILE, which is preferred).\n" +
        "  Generate a pair with: npm run --workspace @accountmanagement/api keygen",
    );
  }

  // Checked whenever a key is supplied, not only in production: a broken key in
  // development fails at the same unhelpful place, on the first login.
  if (env.JWT_PRIVATE_KEY) {
    assertUsablePem("JWT_PRIVATE_KEY", env.JWT_PRIVATE_KEY, "PRIVATE KEY");
  }
  if (env.JWT_PUBLIC_KEY) {
    assertUsablePem("JWT_PUBLIC_KEY", env.JWT_PUBLIC_KEY, "PUBLIC KEY");
  }

  return env;
}

export const ENV = Symbol("ENV");
