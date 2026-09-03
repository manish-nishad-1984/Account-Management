import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const NODE = process.argv[2];      // repo node/ dir
const OUT  = process.argv[3];      // staging dir

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "api"), { recursive: true });
mkdirSync(join(OUT, "packages"), { recursive: true });

const api = join(NODE, "apps", "api");
cpSync(join(api, "dist"), join(OUT, "api", "dist"), { recursive: true });
cpSync(join(api, "drizzle"), join(OUT, "api", "drizzle"), { recursive: true });
cpSync(join(NODE, "tools", "import-masters", "migrate.mjs"), join(OUT, "api", "migrate.mjs"));
cpSync(join(NODE, "apps", "web", "dist"), join(OUT, "web"), { recursive: true });

// The built API imports these, and their versions ("*", "^0.0.0") cannot be
// resolved from a registry — they have to travel with the release.
for (const name of ["domain", "contracts"]) {
  const src = join(NODE, "packages", name);
  const dst = join(OUT, "packages", name);
  mkdirSync(dst, { recursive: true });
  cpSync(join(src, "dist"), join(dst, "dist"), { recursive: true });
  cpSync(join(src, "package.json"), join(dst, "package.json"));
}

const pkg = JSON.parse(readFileSync(join(api, "package.json"), "utf8"));
delete pkg.devDependencies;
for (const dep of Object.keys(pkg.dependencies ?? {})) {
  const m = /^@accountmanagement\/(domain|contracts)$/.exec(dep);
  if (m) pkg.dependencies[dep] = `file:../packages/${m[1]}`;
}
writeFileSync(join(OUT, "api", "package.json"), JSON.stringify(pkg, null, 2) + "\n");

console.log("staged. api deps:");
for (const [k, v] of Object.entries(pkg.dependencies ?? {})) {
  if (k.startsWith("@accountmanagement/")) console.log(`  ${k} -> ${v}`);
}
console.log("dist/main.js present:", existsSync(join(OUT, "api", "dist", "main.js")));
console.log("web/index.html present:", existsSync(join(OUT, "web", "index.html")));
