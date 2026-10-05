# AccountManagement ("Account Book")

Multi-company, multi-site procurement and accounting system — purchase requests,
purchase orders, inward challans, inventory, supplier and sales invoices, payments.

Live at https://avfast.in. **Read [`SESSION-HANDOFF.md`](SESSION-HANDOFF.md) first** — it
holds where the work stands, the decisions already made, and the traps found so far.

## Stack

React 19 + Vite + Tailwind → NestJS 11 (Fastify) → Drizzle → PostgreSQL.
Everything lives in [`node/`](node/):

```
node/
├── packages/domain/       business rules shared by every module (money, numbering, FY)
├── packages/contracts/    Zod schemas shared by the API and the web app
├── tools/import-masters/  the ETL: masters, geography, transactions
├── tools/deploy/
└── apps/
    ├── api/               NestJS + Fastify + Drizzle
    └── web/               React 19 + Vite + Tailwind
```

## Running it

```bash
cd node
npm install
npm run build && npm run typecheck && npm test
```

Locally, in development, the API starts an embedded in-memory PostgreSQL (PGlite) and
seeds it, so no database is needed:

```bash
npm run --workspace @accountmanagement/api build
cd apps/api && NODE_ENV=development PORT=3000 node dist/main.js
# separate terminal:
cd node/apps/web && npx vite --port 5180 --strictPort
```

Open http://localhost:5180/ and sign in as `devuser` / `DevPassword1`. Data is lost on
restart. In Claude Code, `/run-local` does all of this and checks both ports are serving.

## Conventions that are load-bearing

- **Every route is authenticated unless it says otherwise.** `AuthGuard` is registered
  globally via `APP_GUARD`; opting out requires an explicit `@Public()` that shows up in
  the diff.
- **Money is a decimal string end to end** — `numeric` in PostgreSQL, string on the wire,
  string in the input. Never a JS float.
- **Ported rules keep their defects until the business signs off.** `packages/domain`
  reproduces the legacy system's behaviour exactly, with tests that assert the wrong
  answer on purpose and say so. Correcting one needs written business sign-off.
- **Commit before you deploy.** The build reads the working tree, not `HEAD`.

## Migration assessment

[`Migration-Assessment/`](Migration-Assessment/) holds the 18-document assessment, the
legacy screen captures and sequencing plan (`legacy-screens/PLAN.md`), and the open
business questions (`19-Business-Decisions-Required.md`).

The legacy ASP.NET solution it was written against is **not in this repository**. It was
moved out to `AC-legacy-reference/`, next to this folder, and is still in git history.
Handoff and assessment references to `.cs` / `.cshtml` paths point into it.

## CI

`.github/workflows/ci.yml` runs `gitleaks` and the Node build, typecheck and tests.
