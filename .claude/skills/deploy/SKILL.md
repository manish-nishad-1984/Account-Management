---
name: deploy
description: Deploy the Node/React app to the Hostinger VPS (srv1925876.hstgr.cloud), which serves it at https://avfast.in (www.avfast.in and api.avfast.in redirect there) with a spare preview on port 8090. Builds, ships, migrates, restarts and health-checks. Also rolls back to the previous release, seeds real master data, and reports status. Use whenever the user asks to deploy, ship, release, push to the server, roll back, seed the server database, or check what is deployed.
---

# Deploy Account Book to the VPS

Ships the Node/React app to **89.116.122.175**, which serves it at
**https://avfast.in**.

## Read this before doing anything

**The old ASP.NET app and its SQL Server were removed from this server on 8 Oct
2026, at the user's instruction.** Ports 8080, 7251 and 1433 are gone (checked
9 Oct: only nginx on 80 / 443 / 8090 and the API on 127.0.0.1:3101 listen), the
`avfast-web` unit is inactive, and `/opt` holds `accountbook-next` and
`microsoft`. Older sections of `SESSION-HANDOFF.md` (§5e and others) still describe
the old app and its "leave alone" ports; **they are history.** Do not go looking for
8080 / 7251 / 1433 and do not report their absence as a fault.

**The live data is a test copy** (user, 8 Oct 2026) until cutover, so a deploy is
not putting a real business at risk. That is not a reason to be careless: the same
procedure will be used on the real data.

Still shared and still not yours to touch: `/etc/letsencrypt/live/avfast.in/`, the
certificate the hostnames share.

## How the hostnames map

One nginx file, `/etc/nginx/sites-enabled/avfast.conf`, owns them:

| Hostname | Goes to |
|---|---|
| `avfast.in` | **the React app** — static build + `/api/` → `127.0.0.1:3101`. `/` is sent with `Cache-Control: no-cache` and `/assets/` with long caching, so a new release is seen on the next load (a stale bundle once made fixed screens look unfixed). |
| `www.avfast.in`, `api.avfast.in` | **301 → https://avfast.in/** |

There is **no wildcard DNS** and no DNS tool on the MCP connection, so a brand
new hostname needs the user to add an A record in hPanel by hand. Prefer a name
that already resolves.

Every edit to `avfast.conf` is backed up first to `/root/avfast.conf.bak.<stamp>`,
and `nginx -t` must pass before `reload`. If it fails, restore the backup — never
leave that file invalid, it is the site's front door.

**`client_max_body_size` must be at least `12m` on the `/api/` location.** nginx
defaults to **1m**, and it rejects a larger body itself, with its own 413 HTML —
before the request ever reaches the API. The symptom is an attachment under the
app's own 10 MB limit failing with an error the application never wrote and
nothing in its log. 12m leaves room for the multipart framing around a 10 MB
file.

```nginx
location /api/ {
    client_max_body_size 12m;
    proxy_pass http://127.0.0.1:3101;
}
```

Check it before believing an upload bug is in the API:

```bash
grep -n client_max_body_size /etc/nginx/sites-enabled/avfast.conf
```

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
├── uploads/                 attached documents. OUTSIDE releases/ on purpose.
├── releases/<timestamp>/     api/ web/ packages/ — last 5 kept
└── current -> releases/…     atomic switch; rollback is one ln
```

**`uploads/` must never move inside a release.** `current` is a symlink into
`releases/<timestamp>/` and the deploy prunes to the last five, so files written
under a release are deleted by the fifth deploy after they were made — silently,
and only discovered when someone asks for one. It is also outside everything
nginx serves, which is the point: the legacy app kept uploads in `wwwroot/`,
where the web server hands them to anyone who guesses a name (finding H-9).

`write-env.mjs` sets `STORAGE_DIR=/opt/accountbook-next/uploads`, and the API
**refuses to boot in production without it** rather than defaulting to a path
inside the release. It creates the directory and write-tests it at startup, so a
permissions problem fails the deploy instead of the first upload of the day.

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

**Make the script stop, do not rely on reading the output.** On 9 Oct 2026 a deploy
script printed `test exit 1` and carried on to ship, because nothing tested the
exit code. Capture it and exit:

```bash
npm test > "$SP/npmtest.txt" 2>&1; TEST_EXIT=$?
sed 's/\x1b\[[0-9;]*m//g' "$SP/npmtest.txt" | grep -E "Tests +[0-9]+|FAIL"
if [ "$TEST_EXIT" -ne 0 ]; then echo "TESTS FAILED - NOT DEPLOYING"; exit 1; fi
```

Two load flakes are known (Purchase Order `PurchaseOrderFormDialog.itemFill` in web,
and API repository tests that time out at 60 s when another suite is running). If one
fails, re-run THAT file alone; if it passes alone and nothing near it changed, run the
whole suite again before shipping. **Run one suite at a time.**

**Write the deploy as a script file** (Write tool, run with `bash file.sh` in the
background) rather than a long `node -e '...'` or heredoc: apostrophes in the body
break bash with an `unexpected EOF` error that names the wrong line.

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

In full, from `node/`, with `$SP` the session scratchpad:

```bash
REL=$(date +%Y%m%d-%H%M%S); echo "$REL" > "$SP/rel.txt"
node tools/deploy/stage.mjs "E:/nakul/Chintan Kalathiya/AC/node" "$SP/staging-$REL"

# Does the staged page reference the bundle that was just built? If not, the
# build did not run and a stale dist is about to be shipped as if it were new.
grep -o 'index-[A-Za-z0-9_-]*\.js' "$SP/staging-$REL/web/index.html"
ls apps/web/dist/assets | grep -E '^index-.*\.js$'

tar --force-local -czf "$SP/$REL.tgz" -C "$SP/staging-$REL" .
```

`--force-local` is not optional: plain `tar` reads the `C:` in a Windows path as
a remote host and fails with a hostname lookup.

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

The runner records applied tags in `applied_migrations`, one transaction per
migration, so re-running is safe and only new migrations run. **Read its output.**
It used to replay the journal from the start, fail on migration 0000 with
"already exists", and print *"Already migrated. Nothing to do."* while skipping
every migration added since the last deploy — a clean-looking deploy with the new
tables simply absent. Expect a line per migration and an
`N applied, N adopted, N skipped` summary. `0 applied` after shipping a new
migration means something is wrong.

### 6. Switch, restart, verify

**Say what the rollback target is before you move the symlink**, while it is
still trivially readable. It goes in the report, and it is the thing you want at
hand if the next 30 seconds go badly:

```bash
echo "ROLLBACK TARGET: $(readlink -f /opt/accountbook-next/current)"
ln -sfn /opt/accountbook-next/releases/$REL /opt/accountbook-next/current
systemctl restart accountbook-next
```

Then poll `http://127.0.0.1:3101/api/v1/health` for up to 25s. **If it does not
come up, roll back immediately** (see below) and report the last 30 lines of
`/var/log/accountbook-next.log`. Never leave a failed release as `current`.

**Write the poll exactly like this**, or it will lie to you:

```bash
for i in $(seq 1 25); do
  C=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3101/api/v1/health 2>/dev/null || echo 000)
  if [ "$C" = '200' ]; then echo "HEALTHY after ${i}s"; break; fi
  sleep 1
done
```

The `|| echo 000` is not decoration. Under `set -e`, `C=$(curl ...)` takes the
exit status of the command substitution, and curl exits **7** when it cannot
connect — which is exactly what happens on the first pass, while Nest is still
booting. So the script dies on iteration 1, the loop never runs its remaining 24
seconds, and the deploy looks failed.

This cost a needless rollback on 16 Sep 2026. The service had started correctly;
`/var/log/accountbook-next.log` said *"Nest application successfully started"*
while the deploy was being reverted around it. **Before rolling back for a failed
health check, read the log.** A healthy app and a broken poll look identical from
outside, and only the log tells them apart.

A healthy `/health` is **not** enough on its own — it does not touch the signing
key. Always also check a real login:

```bash
curl -s -X POST http://127.0.0.1:3101/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"userName":"ckalathiya","password":"DevPassword1"}'
```

### 7. Fix ownership and permissions

The tar carries Windows uids, and nginx runs as `www-data`.

**ORDER MATTERS HERE, and getting it wrong exposes `DATABASE_URL`.** The broad
`644` walk covers `api/.env` too, so it must finish *before* the `600` lands. Run
it with `-exec ... {} +` and `sync` between the two halves:

```bash
chown -R root:root /opt/accountbook-next
chmod 755 /opt/accountbook-next /opt/accountbook-next/releases

# The broad walks run to completion FIRST.
find /opt/accountbook-next/releases -type d -exec chmod 755 {} +
find /opt/accountbook-next/releases -type f -exec chmod 644 {} +
sync

# ONLY NOW the restrictive ones.
chmod 700 /opt/accountbook-next/keys
chmod 600 /opt/accountbook-next/keys/private.pem /opt/accountbook-next/.dbpass
chmod 600 /opt/accountbook-next/releases/*/api/.env
# Uploads: the service writes them, and NOBODY else reads them — not even
# www-data. Every download goes through the API, which checks the token and the
# permission first.
chmod 700 /opt/accountbook-next/uploads

stat -c '%a %n' /opt/accountbook-next/releases/*/api/.env   # every one must be 600
```

Two things changed here on 16 Sep 2026, both after finding `.env` at **644**
mid-deploy on a live server:

- **`releases/*/api/.env`, not `current/api/.env`.** Every kept release is a
  rollback target, and the `644` walk re-opens the older ones on every deploy. A
  `600` applied only to `current` leaves four readable copies of the database URL
  behind it.
- **`-exec ... {} +`, not `\;`.** One `chmod` per batch instead of one per file:
  on this tree that is the difference between a walk that has finished when the
  next line runs and one that is still travelling. `sync` makes it explicit
  rather than hoping.

Confirm nginx cannot read an attachment directly. If this ever passes, the
uploads are back where the legacy ones were:

```bash
sudo -u www-data ls /opt/accountbook-next/uploads   # must FAIL
```

`/opt/accountbook-next` must be **755**, not 700 — at 700 nginx cannot traverse
it and every page is a 500 with `stat() failed (13: Permission denied)`.

Confirm both directions:

```bash
sudo -u www-data test -r /opt/accountbook-next/current/web/index.html   # must pass
sudo -u www-data test -r /opt/accountbook-next/.dbpass                  # must FAIL
```

### 8. Verify from outside

```bash
curl -o /dev/null -w '%{http_code}\n' https://avfast.in/
curl https://avfast.in/api/v1/health
curl -o /dev/null -w '%{http_code} %{redirect_url}\n' https://www.avfast.in/   # 301 -> https://avfast.in/
curl -o /dev/null -w '%{http_code}\n' http://89.116.122.175:8090/
```

**Check the BUNDLE HASH, not just the status code.** A 200 from `avfast.in` says
nginx is serving something; it does not say it is serving *this* release. The
cheapest honest check there is:

```bash
curl -s https://avfast.in/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.(js|css)'
```

Compare it to `apps/web/dist/assets/`. If they differ, the switch did not take
and everything below is measuring the old build.

3101 must **not** be reachable from outside. Report the URL:
**https://avfast.in/**

### 8b. Look at it

The checks above prove the server is serving. They do not prove the application
works — and on a UI release that is the entire question. Use the
`browser-automation` skill against **https://avfast.in/**, signing in as
`ckalathiya` / `DevPassword1`, and assert the specific thing that shipped.

Worth capturing every time, because all four are cheap and each has caught
something real:

- **console errors and failed requests** — expect 0 and 0 on production (the
  `ERR_ABORTED` noise in dev is StrictMode double-mounting and does not happen in
  a production build)
- `document.documentElement.scrollWidth - clientWidth` — expect **0**, at 1600px
  and at 390px
- a real list rendering real rows, so the API path is exercised end to end
- a screenshot, read back, for anything about layout

Gotcha worth remembering: `patchright` resolves from the CodeGPT install, so run
`browser.mjs` from `C:/Users/PC-8/AppData/Roaming/npm` (or export `NODE_PATH` to
it) or it exits with "Could not resolve patchright".

### 9. Prune

Keep the last five releases:

```bash
ls -1dt /opt/accountbook-next/releases/*/ | tail -n +6 | xargs -r rm -rf
```

---

## What to report when it is done

The point of the run is the report, and these are the lines that have mattered:

- **The URL and the release id** — `https://avfast.in/`, `releases/<REL>`
- **The rollback target**, as a command the user can paste, with the note that
  migrations are not rolled back
- **The gate**: test counts per workspace, typecheck, build
- **The migration summary** verbatim — `N applied, N adopted, N skipped`.
  `0 applied` is correct for a UI-only release and wrong after shipping a new
  migration; say which case this was.
- **That the site is whole**: `avfast.in` 200 with the new bundle hash, `www.avfast.in` redirecting, `.env` at 600, uploads not readable by `www-data`
- **What was actually seen in the browser**, not just what was deployed
- **Anything that went wrong on the way**, including anything self-inflicted.
  A deploy report that hides a needless rollback is worse than no report: the
  next person repeats it.

Raise anything still open on the server (the VPS root password, `ufw` still inactive
unless that has changed) only if it is relevant; the SQL Server exposure that used to
be raised every time is gone with the server.

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
health endpoint, a real login, and row counts in `accountbook_next`.

---

## Seeding data

**Already done** (2026-09-03). The database holds real masters imported from the
local SQL Express copy: 82 units, 3 companies, 13 sites, 171 suppliers, 758
items, 35 site groups, 3 users, 21 forms, 63 permissions.

Every imported user's password is **`DevPassword1`** — real passwords are never
copied. Users: `ckalathiya`, `ac`, `chintanauro`.

The import **truncates and reloads** every table it manages — purchase requests
included — so anything created through the UI since the last load is lost. It
also seeds `document_counters` from the highest request number already issued
per financial year; without that the app reissues numbers the old system used.

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

**The old MVC app and SQL Server no longer exist on this server** (removed 8 Oct
2026), so the earlier notes about the broken MVC app and the exposed port 1433 are
closed. What is still open: the VPS root password was pasted into a session
transcript earlier and is worth rotating (the deploy key makes it unnecessary),
and `ufw` was inactive when last checked. The `sa` password is still in git
history, for a server that is gone.

**Do not run the master importer against the live database without reading
`SESSION-HANDOFF.md` §5w first.** It truncates and reloads the tables it manages,
and the live database now holds data the importer knows nothing about (payout
lists, payments tied to bills, clients, income).
