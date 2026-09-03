import { afterAll, describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv } from "./env";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();

/** A production environment, minus whatever the test is about to vary. */
function prod(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://u:p@127.0.0.1:5432/db",
    JWT_PRIVATE_KEY: PRIVATE_PEM,
    JWT_PUBLIC_KEY: PUBLIC_PEM,
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe("loadEnv", () => {
  it("defaults HOST to 0.0.0.0 so a container is reachable from outside itself", () => {
    expect(loadEnv({} as NodeJS.ProcessEnv).HOST).toBe("0.0.0.0");
  });

  it("keeps an explicit HOST, which is how the API is held to loopback behind nginx", () => {
    expect(loadEnv({ HOST: "127.0.0.1" } as NodeJS.ProcessEnv).HOST).toBe("127.0.0.1");
  });

  it("treats an empty DATABASE_URL as unset rather than failing .url()", () => {
    expect(loadEnv({ DATABASE_URL: "" } as NodeJS.ProcessEnv).DATABASE_URL).toBeUndefined();
  });

  it("refuses production without DATABASE_URL, which would silently lose every write", () => {
    expect(() => loadEnv(prod({ DATABASE_URL: undefined }))).toThrow(/DATABASE_URL is required/);
  });

  it("refuses production without a key pair", () => {
    expect(() => loadEnv(prod({ JWT_PRIVATE_KEY: undefined }))).toThrow(/JWT_PRIVATE_KEY/);
  });

  describe("PEM keys in an environment variable", () => {
    it("accepts real newlines", () => {
      expect(loadEnv(prod()).JWT_PRIVATE_KEY).toBe(PRIVATE_PEM.trim());
    });

    // 92, 110 = the two characters backslash and n. Written this way so the
    // literal cannot be collapsed into a real newline by an editor or a shell.
    const ESCAPED_NEWLINE = String.fromCharCode(92, 110);

    it("decodes newlines escaped as \n, the form systemd and CI secret stores use", () => {
      const escaped = PRIVATE_PEM.trim().split(String.fromCharCode(10)).join(ESCAPED_NEWLINE);
      expect(escaped).not.toContain(String.fromCharCode(10));
      expect(loadEnv(prod({ JWT_PRIVATE_KEY: escaped })).JWT_PRIVATE_KEY).toBe(PRIVATE_PEM.trim());
    });

    it("normalises CRLF, so a key written on Windows still imports", () => {
      const crlf = PRIVATE_PEM.trim().replace(/\n/g, "\r\n");
      expect(loadEnv(prod({ JWT_PRIVATE_KEY: crlf })).JWT_PRIVATE_KEY).toBe(PRIVATE_PEM.trim());
    });

    /**
     * The exact production failure: systemd EnvironmentFile reads one line per
     * variable, so an unquoted multi-line PEM arrives as just its BEGIN line.
     * Before this check it booted happily and returned 500 on the first login.
     */
    it("rejects a PEM truncated to its BEGIN line, and names systemd as the cause", () => {
      const truncated = "-----BEGIN PRIVATE KEY-----";
      expect(() => loadEnv(prod({ JWT_PRIVATE_KEY: truncated }))).toThrow(/systemd EnvironmentFile/);
      expect(() => loadEnv(prod({ JWT_PRIVATE_KEY: truncated }))).toThrow(/JWT_PRIVATE_KEY_FILE/);
    });

    /**
     * The second half of the same production failure. Escaping the newlines to
     * get the PEM onto one line does not help: systemd treats a backslash as an
     * escape in an UNQUOTED value and removes it, so the process receives
     * "-----BEGIN PRIVATE KEY-----nMIIEv..." — markers intact, not a line break
     * anywhere. jose reports "asn1 encoding routines::too long" on first login.
     */
    it("rejects a PEM whose line breaks systemd has eaten, leaving bare n characters", () => {
      const flattened = PRIVATE_PEM.trim().split(String.fromCharCode(10)).join("n");
      expect(flattened).toContain("-----BEGIN PRIVATE KEY-----");
      expect(flattened).toContain("-----END PRIVATE KEY-----");
      expect(() => loadEnv(prod({ JWT_PRIVATE_KEY: flattened }))).toThrow(/no line breaks/);
      expect(() => loadEnv(prod({ JWT_PRIVATE_KEY: flattened }))).toThrow(/JWT_PRIVATE_KEY_FILE/);
    });

    it("rejects a PEM with markers but no real key material", () => {
      const hollow = "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----";
      expect(() => loadEnv(prod({ JWT_PRIVATE_KEY: hollow }))).toThrow(/truncated/);
    });

    it("rejects something that is not a PEM at all", () => {
      expect(() => loadEnv(prod({ JWT_PUBLIC_KEY: "hunter2" }))).toThrow(/not a complete PEM/);
    });

    it("rejects a private key supplied as the public key", () => {
      expect(() => loadEnv(prod({ JWT_PUBLIC_KEY: PRIVATE_PEM }))).toThrow(
        /JWT_PUBLIC_KEY is not a complete PEM/,
      );
    });

    it("still allows development with no keys at all, where an ephemeral pair is generated", () => {
      const env = loadEnv({ NODE_ENV: "development" } as NodeJS.ProcessEnv);
      expect(env.JWT_PRIVATE_KEY).toBeUndefined();
    });

    it("treats an empty key as unset rather than as a malformed one", () => {
      const env = loadEnv({ NODE_ENV: "development", JWT_PRIVATE_KEY: "" } as NodeJS.ProcessEnv);
      expect(env.JWT_PRIVATE_KEY).toBeUndefined();
    });
  });

  /**
   * Reading the key from a file is the only transport that survives systemd, and
   * it also keeps the signing key out of /proc/<pid>/environ.
   */
  describe("PEM keys from a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "env-keys-"));
    const privatePath = join(dir, "private.pem");
    const publicPath = join(dir, "public.pem");
    writeFileSync(privatePath, PRIVATE_PEM);
    writeFileSync(publicPath, PUBLIC_PEM);

    it("reads the pair from JWT_PRIVATE_KEY_FILE / JWT_PUBLIC_KEY_FILE", () => {
      const env = loadEnv(
        prod({
          JWT_PRIVATE_KEY: undefined,
          JWT_PUBLIC_KEY: undefined,
          JWT_PRIVATE_KEY_FILE: privatePath,
          JWT_PUBLIC_KEY_FILE: publicPath,
        }),
      );
      expect(env.JWT_PRIVATE_KEY).toBe(PRIVATE_PEM.trim());
      expect(env.JWT_PUBLIC_KEY).toBe(PUBLIC_PEM.trim());
    });

    it("lets the file win over an inline value, so a stale env var cannot shadow it", () => {
      const env = loadEnv(
        prod({ JWT_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----", JWT_PRIVATE_KEY_FILE: privatePath }),
      );
      expect(env.JWT_PRIVATE_KEY).toBe(PRIVATE_PEM.trim());
    });

    it("fails at startup, naming the path, when the file cannot be read", () => {
      const missing = join(dir, "nope.pem");
      expect(() =>
        loadEnv(prod({ JWT_PRIVATE_KEY: undefined, JWT_PRIVATE_KEY_FILE: missing })),
      ).toThrow(/JWT_PRIVATE_KEY_FILE is .*nope\.pem, which could not be read/);
    });

    it("still validates the contents of a file", () => {
      const bad = join(dir, "truncated.pem");
      writeFileSync(bad, "-----BEGIN PRIVATE KEY-----");
      expect(() =>
        loadEnv(prod({ JWT_PRIVATE_KEY: undefined, JWT_PRIVATE_KEY_FILE: bad })),
      ).toThrow(/not a complete PEM/);
    });

    afterAll(() => {
      rmSync(dir, { recursive: true, force: true });
    });
  });
});
