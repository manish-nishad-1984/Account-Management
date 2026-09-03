import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/opt/accountbook-next";
const release = process.argv[2];
if (!release) {
  console.error("usage: write-env.mjs <release-dir>");
  process.exit(1);
}

const LF = String.fromCharCode(10);
const dbpass = readFileSync(join(ROOT, ".dbpass"), "utf8").trim();

/**
 * The signing keys are passed as PATHS, not values.
 *
 * A PEM cannot survive systemd EnvironmentFile: real newlines truncate the value
 * to its BEGIN line (one line per variable), and escaping them does not help
 * either, because systemd removes the backslash from an unquoted value and the
 * process receives "-----BEGIN PRIVATE KEY-----nMIIEv..." instead. Both reach
 * jose as an opaque asn1 error on the first login. Paths also keep the signing
 * key out of /proc/<pid>/environ.
 */
const lines = [
  "NODE_ENV=production",
  "PORT=3101",
  // Loopback only: the API defaults to 0.0.0.0, which would expose it directly
  // on 3101 and bypass nginx entirely.
  "HOST=127.0.0.1",
  `DATABASE_URL=postgres://accountbook:${dbpass}@127.0.0.1:5432/accountbook_next`,
  `JWT_PRIVATE_KEY_FILE=${join(ROOT, "keys", "private.pem")}`,
  `JWT_PUBLIC_KEY_FILE=${join(ROOT, "keys", "public.pem")}`,
];

const target = join(release, "api", ".env");
writeFileSync(target, lines.join(LF) + LF, { mode: 0o600 });
chmodSync(target, 0o600);

console.log(`wrote ${target} (${lines.length} vars, mode 600)`);
for (const line of lines) {
  const at = line.indexOf("=");
  const key = line.slice(0, at);
  const value = line.slice(at + 1);
  console.log(`  ${key} = ${key === "DATABASE_URL" ? "<redacted>" : value}`);
}
