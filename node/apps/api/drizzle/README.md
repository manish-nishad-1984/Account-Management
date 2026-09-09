# Migrations

Applied by `src/db/migrations.ts` from `meta/_journal.json`, in order, one
transaction each, recorded in `applied_migrations`. Never scan the directory for
`.sql` files — see the note in that file for what that cost.

## Before you run `drizzle-kit generate`, read this

**The snapshot chain was broken from 0008 to 0010 and is repaired from 0011.**

`drizzle-kit generate` does not read the database and does not read the previous
`.sql` files. It diffs the schema in `src/db/schema/` against the **newest
snapshot** in `meta/`, and writes the difference. So a missing snapshot is not a
missing file — it is a wrong diff.

Migrations `0008_purchase_orders`, `0009_purchase_invoices` and
`0010_sales_invoices` were hand-written and their snapshots were never committed.
`meta/` went straight from `0007_snapshot.json` to nothing. On 9 Sep 2026 the
first `generate` after them diffed against **0007** and produced a migration that
re-created `purchase_orders`, `purchase_order_items`, `purchase_invoices`,
`purchase_invoice_items`, `sales_invoices` and `sales_invoice_items` — six tables
that already exist — alongside the one new table that was actually wanted.

**Nothing about that output says it is wrong.** It is valid SQL, it is named
after what you asked for, and it lands in the journal like any other migration.
Shipping it would have failed on the server with `42P07 relation already exists`,
and §5f's adoption logic only swallows that on the FIRST run against a database
that predates the tracking table — so on production it is a hard deploy failure,
found at the worst moment.

`0011_purchase_order_delivery_addresses.sql` is therefore **hand-trimmed to its
real delta**: one new table, its foreign key, its index, and one added column.
`meta/0011_snapshot.json` is the generated one and was KEPT, because it is a full
snapshot of the whole schema — which is what repairs the chain. Diffs from here
on are correct.

### So, when generating a migration

1. Run `npx drizzle-kit generate --name <what_it_does>`.
2. **Read the `.sql` it wrote, all of it.** If it contains `CREATE TABLE` for a
   table you did not add, the chain is broken again — trim the file by hand to
   the real delta and keep the new snapshot.
3. `0011` and later should need no trimming. If one does, say so in the handoff
   rather than only fixing it, because it means a snapshot went missing again.

### The other trap

`drizzle-kit generate` **needs a TTY when a table has both added and dropped
columns** — it prompts to disambiguate a rename from a create-plus-drop, and dies
with "Interactive prompts require a TTY". Generate in two passes: the additive
columns first, then the drop as its own migration.
