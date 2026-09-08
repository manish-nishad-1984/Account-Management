---
name: handoff
description: Hand this session over to the next one by bringing SESSION-HANDOFF.md up to date - append what this session did, refresh the always-current sections that go stale, verify the claims by running the suites, and commit. Pass "check" to report the drift without writing anything, "opener" to print the message to paste into the new session. Use whenever the user asks to hand off, wrap up, end or summarise the session, to write the handoff, or to start a fresh session without losing context.
---

# Hand this session over to the next one

The handoff is **`SESSION-HANDOFF.md` at the repository root**, not a chat
message. A chat summary dies with the window; that file is what the next session
is told to read first, and it is the only thing that survives.

Resolve the repo root with `git rev-parse --show-toplevel` — the session often
starts in `Migration-Assessment/`, and every path below is relative to the root.

## The one thing this command exists to fix

The document has **two halves that age differently**, and only one of them gets
maintained:

| Half | Sections | Ages how |
|---|---|---|
| **Append-only log** | §5, §5b … §5m — one per session | Never wrong. Each is a record of a day that already happened. |
| **Always-current state** | §3, §4, §8, §10, §11 | **Silently wrong.** They describe *now*, and nobody goes back. |

Appending a new §5x is the easy half and it is the half that gets done. The
result is a document whose newest section is accurate and whose *opening* is not
— which is worse than useless, because the opening is what a new session reads
first and trusts most.

When this command was written, §3 and §4 both said **"310 tests pass (19 .NET +
12 domain + 188 API + 91 web)"**. The true figure was more than double, and it
had been wrong across five sessions. Nobody lied; five sessions each appended
their own section and none of them scrolled up.

**So: appending is step 4, not step 1. Do the refresh first.**

---

## Modes

| Argument | Do |
|---|---|
| (none), `write` | The full pass: verify, refresh, append, commit |
| `check` | Report what has drifted. **Change nothing.** |
| `opener` | Print the short message to paste into the new session |

---

## write

### 1. Establish the facts before writing any of them down

Never carry a number forward from the previous section. Run it:

```bash
cd node && npm test        # counts per workspace
cd .. && dotnet test AccountManagement.sln
git log --oneline -15
git status --short
git rev-parse HEAD origin/main     # equal? then it is pushed
```

`npm test` prints a `Tests  N passed` line per workspace — contracts, domain,
api, web. Add them for the Node total and keep the per-workspace breakdown; that
breakdown is what makes the next session's own count comparable.

**If something fails, the handoff says so.** A handoff that claims a green suite
over a red one is the single most expensive thing that can be written in this
file: the next session builds on it, and loses a day to a defect it was told
did not exist. Write the failure, the file, and what you think is wrong.

If `HEAD` and `origin/main` differ, or the tree is dirty, say which — and prefer
committing first (step 5) so the doc can be stamped with a real commit.

### 2. Refresh the always-current sections

Read each of these and correct it against step 1. This is the work.

- **§3 Where the code is** — the tree, and the test total under it. Check the
  directory list still matches `node/apps` and `node/packages`.
- **§4 Repository state** — the total again (it appears twice on purpose, and
  goes stale twice), the branch, whether it is pushed, whether the tree is clean.
- **§8 Blocked — needs the user** — the load-bearing section. Remove what the
  user has since done; **add nothing that is merely unfinished code**. This table
  is for things no amount of work in a session can clear.
- **§10 Environment notes** — only if a tool, port or version actually changed.
- **§11 Suggested next steps** — re-rank it. Delete what got done. If the plan
  moved, say what the NOW item is and where it is tracked
  (`Migration-Assessment/legacy-screens/PLAN.md` holds the sequencing).

Also check the **header block** at the top of the file: the "Written / extended"
dates and the pointer to what is live. If the app was deployed this session, the
release stamp there is wrong.

### 3. Cross-check the documents that must agree

Three files carry overlapping claims and drift apart:

| File | Must agree about |
|---|---|
| `SESSION-HANDOFF.md` | test counts, what is live, what is blocked |
| `Migration-Assessment/legacy-screens/PLAN.md` | the NOW / NEXT sequencing |
| `Migration-Assessment/19-Business-Decisions-Required.md` | the open questions, and the summary sheet at its end |

If this session added a business question, it belongs in doc 19 **and** its
summary sheet **and** its cross-reference table — the summary sheet is the page
that actually gets sent, so a question missing from it does not exist.

### 4. Append the new section

Next letter in the `§5x` sequence. Match the house style, which is specific:

- **A heading that says what changed and when** —
  `## 5n. <what it did, in plain words> (<date>)`, not "Session 14".
- **Stamp it with the commit** as the first line. If the commit does not exist
  yet, write `<COMMIT>` and replace it in step 5 — there is precedent for a
  separate one-line "stamp" commit and it is fine.
- **The decision and its reason**, not a changelog. `git log` already holds the
  list of files. What it cannot hold is *why the other option was rejected*.
- **What went wrong and how it was found.** The most valuable paragraphs in this
  file are the traps: the PEM that cannot travel in a systemd variable, the
  migration runner that printed success while skipping migrations, the Tailwind
  variant order that silently dropped a padding class. Each cost hours once and
  now costs nothing. **A section with no trap in it is usually a section that
  was written from memory rather than from what happened.**
- **Anything reproduced from the legacy system on purpose**, so the next session
  does not "fix" it. Ported defects stay until the business signs off.
- **The honest cost** of what was built — the thing it made worse, measured.

Keep prose. Do not compress a hard-won finding into a bullet of three words.

### 5. Commit

```bash
git add -A && git commit && git push origin main
```

`git push` alone targets `upstream` and 403s — **it must be `git push origin main`**.

Commit message: what the session accomplished, in the imperative, the way the
existing log reads (`Port Inward Challans, with the grid's first footer
aggregate`). Then stamp `<COMMIT>` in the new section with the hash and commit
that stamp.

### 6. Print the opener

Finish by printing the paste-into-the-next-session message from `opener` below,
so the user can start the new window immediately.

---

## check

Report, changing nothing:

- Every test total stated in the file, next to the measured one.
- Whether the tree is clean and whether `HEAD` is pushed.
- Which §5x section is last, and whether this session's work is in it.
- Any §8 blocker or §11 step that looks done.
- Whether PLAN.md's NOW row and doc 19's summary sheet still agree with §11.

Say what is stale. Do not fix it — `check` is for deciding whether to spend the
time.

---

## opener

The next session is told to read the file, so the opener is short on purpose. It
carries only what a fresh window cannot recover from the repository: where to
start, and what is running right now.

```
Read SESSION-HANDOFF.md at the repo root first — it is current as of <commit>.

Live: https://avfast.in, release <rel>.       (omit if not deployed)
Local: API 3000, web http://localhost:5180/, devuser / DevPassword1.
                                              (omit if not running)
Next: <the NOW row from Migration-Assessment/legacy-screens/PLAN.md>.
```

Do **not** restate the constraints in the opener. Port 5173, the money-as-string
rule, the ports on the VPS that must not be touched — those are in
`SESSION-HANDOFF.md` and in the `/run-local` and `/deploy` skills, which the next
session loads anyway. A copy in a chat message is one more place to fall out of
date, and the next session has no way to tell which copy is current.

_(There is no `CLAUDE.md` in this repository. If one is ever added, the durable
constraints belong there and this file should point at it rather than repeat
it.)_

---

## Things that are true regardless of mode

- **Never write a claim you have not run.** "Everything passes" is a measurement,
  not a courtesy.
- **The blocked list is the user's, not yours.** Items sit in §8 for weeks —
  rotating the `sa` credential, running the census, sending doc 19. Do not quietly
  drop one because it has been there a long time, and do not re-argue it.
- **Do not delete an old §5x section.** They are the archaeology. If one is now
  wrong, add a line saying so where it is, and leave the rest.
- **The file is ~1400 lines and that is not a problem.** It is read once, by an
  agent, at the start of a session. Optimising it for brevity is optimising the
  wrong thing — every trap deleted to save a screenful costs the next session an
  afternoon.
