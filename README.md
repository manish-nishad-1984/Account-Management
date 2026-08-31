# AccountManagement ("Account Book")

Multi-company, multi-site procurement and accounting system — purchase requests,
purchase orders, inward challans, inventory, supplier and sales invoices, payments.

A full technical assessment of this codebase lives in [`Migration-Assessment/`](Migration-Assessment/).
Start with [`01-Executive-Summary.md`](Migration-Assessment/01-Executive-Summary.md)
and [`18-GO-NO-GO-Assessment.md`](Migration-Assessment/18-GO-NO-GO-Assessment.md).

## Projects

| Project | Target | Role |
|---|---|---|
| `AccountManagement.API` | net8.0 | Web API, JWT bearer. 14 controllers, thin — they call services 1:1 |
| `AccountManegments.Web` | net8.0 | ASP.NET Core MVC + Razor. A pure HTTP proxy to the API; holds session and presentation only |
| `AccountManagement.Repository` | net8.0 | The system. 16 repositories hold all business logic; the 15 services are pass-through |
| `AccountManagement.DBContext` | net8.0 | EF Core 7 model, 28 entities |
| `AccountManagement.Tests` | net8.0 | xUnit |

## Prerequisites

- .NET SDK 8.0 or later
- SQL Server (local instance or Docker) — **do not develop against production**
- `dotnet dev-certs https --trust` (once, so the HTTPS profiles work)

## Configuration and secrets

**No credentials are stored in `appsettings.json`.** The API fails fast at startup
with an actionable message if configuration is missing.

Local development uses [user-secrets](https://learn.microsoft.com/aspnet/core/security/app-secrets):

```bash
dotnet user-secrets set "ConnectionStrings:ACCDbconn" \
  "Data Source=localhost,1433;Initial Catalog=DBAccManegment_Dev;User ID=sa;Password=<yours>;TrustServerCertificate=True" \
  --project AccountManegmentAPI

dotnet user-secrets set "Jwt:Key" "<a random string of at least 32 characters>" \
  --project AccountManegmentAPI
```

Servers use environment variables — double underscore is the section separator:

```
ConnectionStrings__ACCDbconn
Jwt__Key
```

## Getting a development database

Restore a production backup into a local instance, then **scrub it** before use —
the `User` table currently stores passwords in plaintext, and the database holds
real supplier and customer records.

## Running

Both projects must run together. The solution has a multi-startup profile
(`AccountManagement.slnLaunch.user`), or from the command line in two terminals:

```bash
dotnet run --project AccountManegmentAPI      # https://localhost:7251  (Swagger at /swagger)
dotnet run --project AccountManegments.Web    # https://localhost:7001
```

In `Development`, the Web project points at `https://localhost:7251/api/` via
`appsettings.Development.json`. Production URLs live in `appsettings.json` and are
not used locally.

## Tests

```bash
dotnet test AccountManagement.sln
```

`AccountManagement.Tests` currently holds **characterisation** tests: they pin down
what the system does *today*, including known defects, so that any behaviour change
is deliberate and visible. See `FinancialYearTests.cs` — some assertions encode a
bug on purpose and say so.

## Conventions when changing this codebase

- **Money arithmetic belongs in C#, not JavaScript.** Today it is the reverse:
  `Math.Round`, `CGST`, `SGST` and `IGST` appear zero times in C#, and the server
  persists whatever the browser sends. Every calculation moved server-side is one
  less thing to port later.
- **Wrap header/detail writes in a transaction.** `BeginTransaction` has zero
  matches in the repository layer, and three invoice paths delete line items,
  commit, then re-insert.
- **Paginate new list endpoints.** `DataTableRequstModel` already defines `skip`
  and `pageSize`; no repository reads them yet. Use `.Skip()`/`.Take()`.
- **`AsNoTracking()` on read-only queries.**
- **Business rules that are known to be wrong go in `AccountManegment.Repo/Domain/`**,
  reproduced exactly as production behaves, with tests — not silently corrected.
  Correcting one requires written business sign-off (assessment blocker 2).

## CI

`.github/workflows/ci.yml` builds, tests, and runs `gitleaks`.

## Node.js migration (in progress)

The target stack is specified in
[`Migration-Assessment/16-Technology-Stack.md`](Migration-Assessment/16-Technology-Stack.md).
Work in progress lives in [`node/`](node/):

```
node/
├── packages/domain/    business rules shared by every module (money, numbering, FY)
└── apps/api/           NestJS + Fastify
```

```bash
cd node
npm install
npm run build && npm test
JWT_SECRET="<32+ chars>" npm run --workspace @accountmanagement/api dev
```

Two conventions that are load-bearing:

- **Every route is authenticated unless it says otherwise.** `AuthGuard` is
  registered globally via `APP_GUARD`; opting out requires an explicit `@Public()`
  that shows up in the diff. This is the direct answer to assessment finding C-6,
  where two endpoints granted administrator rights because nobody wrote
  `[Authorize]`.
- **Ported rules keep their defects until the business signs off.**
  `packages/domain` reproduces current production behaviour exactly, with tests
  that assert the wrong answer on purpose and say so. The matching .NET tests in
  `AccountManagement.Tests` must agree case for case — that is what makes a port
  verifiable.
