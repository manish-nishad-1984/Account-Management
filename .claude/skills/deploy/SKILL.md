---
name: deploy
description: Deploy the Node/React app to the Hostinger VPS (srv1925876.hstgr.cloud) as a side-by-side preview on port 8090, leaving the live ASP.NET app and SQL Server untouched. Builds, ships, migrates, restarts and health-checks. Also rolls back to the previous release, and reports status. Use whenever the user asks to deploy, ship, release, push to the server, roll back, or check what is deployed.
---

# Deploy Account Book to the VPS

Ships the Node/React app to **89.116.122.175** as a **preview alongside** the
live system. Never a replacement.

## Read this before doing anything

**This server runs the live business.** Nothing in this procedure may touch:

| Leave alone | What it is |
|---|---|
| nginx `avfast.conf`, ports 80 / 443 | avfast.in, www.avfast.in, api.avfast.in |
| `127.0.0.1:8080` | `dotnet /opt/avfast/web` — the live MVC app |
| `127.0.0.1:7251` | `dotnet /opt/avfast/api` — the live API |
| `0.0.0.0:1433` | SQL Server, the production database |

**Port 8080 is taken by the live app.** The preview uses **8090**. Do not assume
8080 is free — it was the first plan and it was wrong.

The app is **masters only**. Purchase orders, invoices and payments are not
migrated, so this is a preview to look at, not something to point users at.

## What is already on the server

Set up once and reused by every deploy — do NOT recreate these:

```
/opt/accountbook-next/
├── .dbpass                  generated once. 600.
├── keys/private.pem         RS256, generated once. 600.
│                            Regenerating signs every user out.
├── keys/public.pem
├── releases/<timestamp>/    api/ web/ packages/ — last 5 kept
└── current -> releases/…    atomic switch; rollback is one ln
```

- systemd unit `accountbook-next.service`, logs to `/var/log/accountbook-next.log`
- nginx `accountbook-next.conf` on **8090** (its own file; `avfast.conf` untouched)
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

---

## deploy

### 1. Refuse to ship a broken build

```bash
cd node && npm test && npm run build
```

If anything fails, stop and report. Do not deploy over a failing suite.

### 2. Stage the release

`REL=$(date +%Y%m%d-%H%M%S)`, then into a staging dir:

- `api/dist`, `api/drizzle`, `api/package.json`
- `web/` ← contents of `apps/web/dist`
- `packages/domain`, `packages/contracts` — their `dist` **and** `package.json`
- `api/migrate.mjs` ← `tools/import-masters/migrate.mjs`

**The workspace packages must be shipped.** The built API imports
`@accountmanagement/domain` and `@accountmanagement/contracts`, whose versions
are `*` and `^0.0.0` — `npm ci` cannot resolve those standalone.

Rewrite the two deps in the staged `api/package.json` to
`file:../packages/<name>` and drop `devDependencies` and the lockfile.

### 3. Ship and install

`tar czf`, `scp` to `/opt/accountbook-next/releases/`, extract, then in `api/`:

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

`/opt/accountbook-next/releases/$REL/api/.env`, mode **600**:

```
NODE_ENV=production
PORT=3101
HOST=127.0.0.1
DATABASE_URL=postgres://accountbook:<.dbpass>@127.0.0.1:5432/accountbook_next
JWT_PRIVATE_KEY=<private.pem, newlines as \n>
JWT_PUBLIC_KEY=<public.pem, newlines as \n>
```

`HOST=127.0.0.1` matters: the API defaults to `0.0.0.0`, which would expose it
directly on 3101 and bypass nginx.

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
curl -o /dev/null -w '%{http_code}\n' http://89.116.122.175:8090/
curl http://89.116.122.175:8090/api/v1/health
curl -o /dev/null -w '%{http_code}\n' -k https://avfast.in/
curl -o /dev/null -w '%{http_code}\n' -k https://api.avfast.in/
```

Check 8080, 7251 and 1433 are all still listening. Report the preview URL:
**http://89.116.122.175:8090/**

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
health endpoint, row counts in `accountbook_next`, and that 8080/7251/1433 are
still up.

---

## Seeding data

A fresh database is **empty** — migrations create tables, nothing more, and
`DevSeed` does not run under `NODE_ENV=production`. Logging in returns 401 until
data exists.

To load the real masters, tunnel to the VPS PostgreSQL and run the importer
against it:

```bash
ssh -i ~/.ssh/accountbook_deploy -N -L 15432:127.0.0.1:5432 root@89.116.122.175 &
# PGURL=postgres://accountbook:<.dbpass>@127.0.0.1:15432/accountbook_next
cd node/tools/import-masters && node --env-file=<env> import.mjs
```

Every imported user's password becomes `DevPassword1`; real passwords are never
copied. See `node/tools/import-masters/README.md`.

## Known outstanding problem

**SQL Server listens on `0.0.0.0:1433`** — reachable from the whole internet,
while its sibling ports 1431 and 1434 are correctly on loopback. The `sa`
password is also in public git history. `ufw` is inactive. Raise this every
time; it is more urgent than any deployment.
