---
name: run-local
description: Start the Account Book app on localhost so the user can look at it - builds the API, boots NestJS on port 3000 and Vite on 5180, verifies both are actually serving, and prints the sign-in details. Pass "stop" to shut them down, "restart" to do both, "status" to check. Use whenever the user asks to run, start, boot, launch or open the app, to see it on localhost, or to stop the dev servers.
---

# Run Account Book locally

Two processes: the NestJS API on **3000** and the Vite dev server on **5180**.
Both must be running — the web app is useless without the API behind it.

## The one rule that matters

**Never touch port 5173.** It belongs to another of the user's apps (ShreeHari
Solar). Only ever inspect or kill **3000** and **5180**. If a command would take
down anything else, don't run it.

## Paths

`<repo>` below is the repository root — resolve it with `git rev-parse --show-toplevel`,
because the session may start in a subdirectory such as `Migration-Assessment/`
and relative paths will then be wrong. `<scratchpad>` is the scratchpad directory
named in the system prompt; logs go there, never in the repo.

## Modes

Read the argument. No argument means `start`.

| Argument | Do |
|---|---|
| (none), `start` | Free the ports, build, boot both, verify, report |
| `stop` | Stop whatever is on 3000 and 5180, confirm they are free |
| `restart` | `stop` then `start` |
| `status` | Report what is listening and whether the API answers. Change nothing. |

---

## start

### 1. Clear the ports first

Stale servers from an earlier session are a recurring nuisance here — they hold
the port and serve **stale code**, which looks exactly like "my change didn't
work".

```powershell
foreach ($p in 3000,5180) {
  $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
  if ($null -ne $c) { Stop-Process -Id $c[0].OwningProcess -Force -ErrorAction SilentlyContinue; "freed port $p" }
  else { "port $p already free" }
}
```

### 2. Build the API

The API runs from compiled output, so a source change needs this. Vite serves
the web app from source — it needs no build.

```bash
cd "<repo>/node" && npm run --workspace @accountmanagement/api build
```

If `node_modules` is missing, run `npm install` in `node/` first.

### 3. Boot both

Start each with the Bash tool's `run_in_background`, redirecting to a log in the
scratchpad so the output can be read if something fails.

```bash
# API
cd "<repo>/node/apps/api" && NODE_ENV=development PORT=3000 node dist/main.js > "<scratchpad>/api.log" 2>&1

# Web
cd "<repo>/node/apps/web" && npx vite --port 5180 --strictPort > "<scratchpad>/web.log" 2>&1
```

`--strictPort` is deliberate: it must fail loudly rather than silently drift onto
5173 and collide with the user's other app.

### 4. Verify before telling the user it is up

Never report success off the back of a launched process. Poll until both answer:

```bash
for i in $(seq 1 40); do
  H=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/health 2>/dev/null)
  W=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5180/ 2>/dev/null)
  if [ "$H" = "200" ] && [ "$W" = "200" ]; then echo "BOTH UP after ${i}s"; break; fi
  sleep 1
done
curl -s http://localhost:3000/api/v1/health; echo
```

Health returns `{"status":"ok","timestamp":...,"financialYear":"26-27"}`.

Then prove the whole path works end to end, including the Vite proxy:

```bash
curl -s -o /dev/null -w "login %{http_code}\n" -X POST http://localhost:5180/api/v1/auth/login \
  -H "Content-Type: application/json" -d '{"userName":"devuser","password":"DevPassword1"}'
```

A 200 means web → proxy → API → database all work. If this fails but health
passed, the problem is the proxy or auth, not the API.

If either server never comes up, read its log in the scratchpad and report what
it actually says. Do not guess.

### 5. Report

Give the user:

- **http://localhost:5180/**
- Sign in: **`devuser`** / **`DevPassword1`**
- Confirmation that both answered, and the financial year from the health check

---

## stop

```powershell
foreach ($p in 3000,5180) {
  $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
  if ($null -ne $c) { Stop-Process -Id $c[0].OwningProcess -Force -ErrorAction SilentlyContinue; "stopped port $p" }
  else { "port $p already free" }
}
Start-Sleep -Seconds 2
foreach ($p in 3000,5180,5173) {
  $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
  if ($null -eq $c) { "port $p : free" } else { "port $p : still listening" }
}
```

Check 5173 in the readback only to confirm it was **not** disturbed. Never stop it.

Background tasks that were killed report a non-zero exit (commonly 127). That is
the kill being reported, not a failure — don't present it as an error.

---

## status

Report what is listening on 3000, 5180 and 5173 (with process names), and whether
`GET /api/v1/health` answers. Change nothing.

---

## Things that look like bugs and are not

Mention these only when relevant — if the user is about to click around, or is
reporting one of them as broken.

- **Refreshing the page signs you out.** The access token is held in memory only,
  never in `localStorage`. This is a deliberate decision, not a session bug.
  Navigate with the sidebar rather than reloading.
- **The data resets on every API restart.** With no `DATABASE_URL` the API boots
  an embedded in-memory PGlite, applies the real migrations and reseeds: 30
  companies, 45 sites, 12 site groups, 30 suppliers, 50 items, 12 units, 41 users.
  Edits do not survive a restart. It has never talked to the live SQL Server and
  must not.
- **Site Groups has no Add / Edit / Delete.** Intentional, and the page says why:
  `Group-View` is the only group permission in the entire .NET solution, so writes
  would be unauthorised. Not a half-built screen.
- **Screens marked "soon" in the sidebar are not built yet.** They route to a
  placeholder on purpose.
- **`ERR_ABORTED` on list requests in the browser console** is React StrictMode
  double-mounting in dev; TanStack Query's abort signal is forwarded to `fetch`,
  so the first request is cancelled and the second succeeds. Dev-only, and
  evidence the cancellation works.

## API notes, if curling it directly

- Everything is under the prefix **`/api/v1`** — `/health` alone returns 404.
- List responses are `{rows, nextCursor, total}`. The array key is **`rows`**.
- `limit` is capped at **200**; anything higher is a 400 validation error.
- Every route needs a bearer token except those marked `@Public()`.
