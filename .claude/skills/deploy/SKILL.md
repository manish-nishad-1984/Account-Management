---
name: deploy
description: Deploy the Node/React app to the Hostinger VPS (srv1925876.hstgr.cloud), which serves it at https://avfast.in with the live ASP.NET app kept on https://www.avfast.in and a spare preview on port 8090. Builds, ships, migrates, restarts and health-checks. Also rolls back to the previous release, seeds real master data, and reports status. Use whenever the user asks to deploy, ship, release, push to the server, roll back, seed the server database, or check what is deployed.
---

# Deploy Account Book to the VPS

Ships the Node/React app to **89.116.122.175**, which serves it at
**https://avfast.in**.

## Read this before doing anything

**This server also runs the live business.** Nothing in this procedure may touch:

| Leave alone | What it is |
|---|---|
| `127.0.0.1:8080` | `dotnet /opt/avfast/web` — the live MVC app |
| `127.0.0.1:7251` | `dotnet /opt/avfast/api` — the live API |
| `0.0.0.0:1433` | SQL Server, the production database |
| `/etc/letsencrypt/live/avfast.in/` | the certificate all three hostnames share |

The app is **masters only**. Purchase orders, invoices, inward and payments are
not migrated. Anyone who needs those wants **www.avfast.in**.

## How the hostnames map

One nginx file, `/etc/nginx/sites-enabled/avfast.conf`, owns all three:

| Hostname | Goes to |
|---|---|
| `avfast.in` | **the new React app** — static build + `/api/` → `127.0.0.1:3101` |
| `www.avfast.in` | the live ASP.NET MVC app → `127.0.0.1:8080`. `default_server`, so any other hostname pointing here lands where it always did. |
| `api.avfast.in` | the live ASP.NET API → `127.0.0.1:7251` |

The user asked for the root to be the new app (2026-09-03) knowing it is masters
only. The live system was given `www` because that hostname was **already in DNS
and already on the certificate** — no record to add, nothing to re-issue.

There is **no wildcard DNS** and no DNS tool on the MCP connection, so a brand
new hostname (`next.avfast.in`, say) needs the user to add an A record in hPanel
by hand. Prefer a name that already resolves.

Every edit to `avfast.conf` is backed up first to `/root/avfast.conf.bak.<stamp>`,
and `nginx -t` must pass before `reload`. If it fails, restore the backup — never
leave that file invalid, it is the live business's front door.

Port **8090** still serves the same app on its own vhost
(`accountbook-next.conf`), which is useful for checking a release without going
through the domain.

## What is already on the server

Set up once and reused by every deploy — do NOT recreate these:

```
/opt/accountbook-next/
├── .dbpass                  generated once. 600.
├── keys/private.pem         RS256, generated once. 600.
│                            Regenerating signs every user out.
├── keys/public.pem
├── write-env.mjs            writes a release's .env (repo: node/tools/deploy/)
├── releases/<timestamp>/     api/ web/ packages/ — last 5 kept
└── current -> releases/…     atomic switch; rollback is one ln
```

- systemd unit `accountbook-next.service`, logs to `/var/log/accountbook-next.log`
- PostgreSQL 16 on 127.0.0.1:5432, role `accountbook`, database `accountbook_next`
- API on **127.0.0.1:3101**, loopback only via `HOST=127.0.0.1`

SSH: `ssh -i ~/.ssh/accountbook_deploy root@89.116.122.175` (key auth, no password).

## Modes

| Argument | Do |
|---|---|
| (none), `deploy` | Full deploy: test, build, ship, migrate, restart, verify |
| `status` | What is running and which release. Change nothing. |
| `rollback` | Point `current` at the previous release and restart |
| `logs` | Tail the service log |
| `seed` | Load real master data (see **Seeding data**) |

---

## deploy

### 1. Refuse to ship a broken build

```bash
cd node && npm test && npm run build
```

If anything fails, stop and report. Do not deploy over a failing suite.

### 2. Stage the release

`REL=$(date +%Y%m%d-%H%M%S)`, then run **`node tools/deploy/stage.mjs <node dir> <staging dir>`**,
which assembles:

- `api/dist`, `api/drizzle`, `api/package.json`
- `web/` ← contents of `apps/web/dist`
- `packages/domain`, `packages/contracts` — their `dist` **and** `package.json`
- `api/migrate.mjs` ← `tools/import-masters/migrate.mjs`

and rewrites the two workspace deps to `file:../packages/<name>`, dropping
`devDependencies`.

**The workspace packages must be shipped.** The built API imports
`@accountmanagement/domain` and `@accountmanagement/contracts`, whose versions
are `*` and `^0.0.0` — `npm ci` cannot resolve those standalone.

### 3. Ship and install

`tar --force-local -czf` (plain `tar` reads `C:/…` as a remote host and fails),
`scp` to `/opt/accountbook-next/releases/`, extract, then in `api/`:

```bash
npm install --omit=dev --no-audit --no-fund
```

**Then replace the two symlinks with real copies:**

```bash
rm -rf api/node_modules/@accountmanagement/{contracts,domain}
cp -r packages/contracts api/node_modules/@accountmanagement/contracts
cp -r packages/domain    api/node_modules/@accountmanagement/domain
```

Why: `file:` deps are symlinked, and Node resolves a symlinked package from its
**real** path — so it walks up from `packages/` and never sees
`api/node_modules`, where `zod` lives. Symptom is
`Cannot find module 'zod'` from inside `contracts/dist/auth.js`. Verify with:

```bash
node -e "require('@accountmanagement/contracts');require('@accountmanagement/domain')"
```

### 4. Write the env file

```bash
node /opt/accountbook-next/write-env.mjs /opt/accountbook-next/releases/$REL
```

That writes `api/.env` at mode 600 with `NODE_ENV`, `PORT=3101`,
`HOST=127.0.0.1`, `DATABASE_URL`, and the keys **as paths**:

```
JWT_PRIVATE_KEY_FILE=/opt/accountbook-next/keys/private.pem
JWT_PUBLIC_KEY_FILE=/opt/accountbook-next/keys/public.pem
```

**Never put a PEM value in that file.** systemd cannot carry one, in two
different ways, and both cost a debugging session:

- `EnvironmentFile` reads **one line per variable**, so a real multi-line PEM
  arrives as just `-----BEGIN PRIVATE KEY-----` → jose:
  `asn1 encoding routines::not enough data`
- escaping the newlines does not help either: in an **unquoted** value systemd
  treats a backslash as an escape and **removes** it, so the process receives
  `-----BEGIN PRIVATE KEY-----nMIIEv…` with no line breaks → jose:
  `asn1 encoding routines::too long`

Neither shows up at boot. Both surface as **HTTP 500 on the first login**, while
a *wrong* password still correctly returns 401 — so the symptom looks like a key
problem only if you read the log. `apps/api/src/config/env.ts` now refuses to
boot on either shape and says which variable and why; `env.test.ts` locks that
in. Paths also keep the signing key out of `/proc/<pid>/environ`.

`HOST=127.0.0.1` matters too: the API defaults to `0.0.0.0`, which would expose
it directly on 3101 and bypass nginx.

### 5. Migrate

```bash
cd api && PGURL="$DATABASE_URL" MIGRATIONS_DIR=./drizzle node migrate.mjs
```

**The API does not migrate a real database.** `database.module.ts` applies
migrations only on the embedded PGlite path; with `DATABASE_URL` set it just
connects. Migrating here is not optional.

### 6. Switch, restart, verify

```bash
ln -sfn /opt/accountbook-next/releases/$REL /opt/accountbook-next/current
systemctl restart accountbook-next
```

Then poll `http://127.0.0.1:3101/api/v1/health` for up to 25s. **If it does not
come up, roll back immediately** (see below) and report the last 30 lines of
`/var/log/accountbook-next.log`. Never leave a failed release as `current`.

A healthy `/health` is **not** enough on its own — it does not touch the signing
key. Always also check a real login:

```bash
curl -s -X POST http://127.0.0.1:3101/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"userName":"ckalathiya","password":"DevPassword1"}'
```

### 7. Fix ownership and permissions

The tar carries Windows uids, and nginx runs as `www-data`:

```bash
chown -R root:root /opt/accountbook-next
chmod 755 /opt/accountbook-next /opt/accountbook-next/releases
find /opt/accountbook-next/releases -type d -exec chmod 755 {} \;
find /opt/accountbook-next/releases -type f -exec chmod 644 {} \;
chmod 700 /opt/accountbook-next/keys
chmod 600 /opt/accountbook-next/keys/private.pem /opt/accountbook-next/.dbpass
chmod 600 /opt/accountbook-next/current/api/.env
```

`/opt/accountbook-next` must be **755**, not 700 — at 700 nginx cannot traverse
it and every page is a 500 with `stat() failed (13: Permission denied)`.

Confirm both directions:

```bash
sudo -u www-data test -r /opt/accountbook-next/current/web/index.html   # must pass
sudo -u www-data test -r /opt/accountbook-next/.dbpass                  # must FAIL
```

### 8. Verify from outside, and that production survived

```bash
curl -o /dev/null -w '%{http_code}\n' https://avfast.in/
curl https://avfast.in/api/v1/health
curl -o /dev/null -w '%{http_code}\n' https://www.avfast.in/
curl -o /dev/null -w '%{http_code}\n' https://api.avfast.in/
curl -o /dev/null -w '%{http_code}\n' http://89.116.122.175:8090/
```

Check 8080, 7251 and 1433 are all still listening, and that 3101 is **not**
reachable from outside. Report the URL: **https://avfast.in/**

### 9. Prune

Keep the last five releases:

```bash
ls -1dt /opt/accountbook-next/releases/*/ | tail -n +6 | xargs -r rm -rf
```

---

## rollback

```bash
PREV=$(ls -1dt /opt/accountbook-next/releases/*/ | sed -n 2p)
ln -sfn "${PREV%/}" /opt/accountbook-next/current
systemctl restart accountbook-next
```

Then health-check as in step 6. Migrations are **not** rolled back — a release
whose migration is incompatible with the previous code cannot be undone this
way, so check before relying on it.

---

## status

Report, changing nothing: `systemctl is-active accountbook-next`,
`readlink /opt/accountbook-next/current`, what is listening on 3101/8090, the
health endpoint, a real login, row counts in `accountbook_next`, and that
8080/7251/1433 are still up.

---

## Seeding data

**Already done** (2026-09-03). The database holds real masters imported from the
local SQL Express copy: 82 units, 3 companies, 13 sites, 171 suppliers, 758
items, 35 site groups, 3 users, 21 forms, 63 permissions.

Every imported user's password is **`DevPassword1`** — real passwords are never
copied. Users: `ckalathiya`, `ac`, `chintanauro`.

A **fresh** database is empty; migrations create tables and nothing more, and
`DevSeed` does not run under `NODE_ENV=production`, so login returns 401 until
data exists. To reload, tunnel to the VPS PostgreSQL and run the importer
against it:

```bash
ssh -i ~/.ssh/accountbook_deploy -N -L 15432:127.0.0.1:5432 root@89.116.122.175 &
# PGURL=postgres://accountbook:<.dbpass>@127.0.0.1:15432/accountbook_next
cd node/tools/import-masters && node --env-file=<env> import.mjs --dry-run   # look first
cd node/tools/import-masters && node --env-file=<env> import.mjs
```

The importer reads the **local** SQL Express, not the production server. It
refuses orphans and reports them; see `node/tools/import-masters/README.md`.

## Known outstanding problems

**The live MVC app is broken, and has been since 28 Aug 2026.** Every Razor view
throws `System.BadImageFormatException: Could not load file or assembly
'<Unknown>'. Index not found.`, so every page 302-loops to
`/Authentication/UserLogin?ReturnUrl=%2FHome%2FError`. Static files still serve.
Cause: 70 files in `/opt/avfast/web` have an mtime of **26 Aug 14:51** while the
process started at **26 Aug 12:47** — a deployment replaced the assemblies under
the running process. `systemctl restart avfast-web` is very likely the whole fix,
but it is the user's production service: **ask before restarting it.** This is
not caused by anything in this procedure — it reproduces against
`127.0.0.1:8080` directly, with the original `Host: avfast.in`.

**SQL Server listens on `0.0.0.0:1433`** — reachable from the whole internet,
while its sibling ports 1431 and 1434 are correctly on loopback. The `sa`
password is also in public git history. `ufw` is inactive. Raise this every
time; it is more urgent than any deployment.
