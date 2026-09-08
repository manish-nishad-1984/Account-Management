import { beforeEach, describe, expect, it } from "vitest";
import { createSupplierSchema, listQuerySchema } from "@accountmanagement/contracts";
import { SuppliersRepository } from "./suppliers.repository";
import { freshDatabase } from "../../test/fresh-database";
import type { Database } from "../../db/database";

const ACTOR = "11111111-1111-1111-1111-111111111111";

describe("supplier approval (real PostgreSQL)", () => {
  let suppliers: SuppliersRepository;

  const make = async (name: string, isApproved: boolean) =>
    suppliers.create(
      createSupplierSchema.parse({ name, area: "Ring Road", isApproved }),
      ACTOR,
    );

  const query = (overrides: Record<string, unknown> = {}) => listQuerySchema.parse(overrides);

  beforeEach(async () => {
    const db: Database = await freshDatabase();
    suppliers = new SuppliersRepository(db);
  });

  it("filters the pending queue and counts it consistently", async () => {
    await make("Pending Supplier", false);
    await make("Approved Supplier", true);

    const page = await suppliers.list(query({ limit: 10 }), { isApproved: false });
    expect(page.rows.map((row) => row.name)).toEqual(["Pending Supplier"]);
    expect(await suppliers.total(undefined, { isApproved: false })).toBe(1);
    expect(await suppliers.total()).toBe(2);
  });

  /** `ActiveDeactiveSupplier` toggles; this states the value. */
  it("states approval rather than toggling it", async () => {
    const supplier = await make("Asian Granito", false);

    expect((await suppliers.setApproval(supplier.id, true, ACTOR)).isApproved).toBe(true);
    expect((await suppliers.setApproval(supplier.id, true, ACTOR)).isApproved).toBe(true);
    expect((await suppliers.setApproval(supplier.id, false, ACTOR)).isApproved).toBe(false);
  });

  it("returns a detail whose openingBalanceDate is a string, not a Date", async () => {
    const supplier = await make("Date Check", false);
    const updated = await suppliers.setApproval(supplier.id, true, ACTOR);

    // The row comes back through `toDetail`; skipping it would put a Date on the
    // wire where the contract promises an ISO string.
    expect(updated.openingBalanceDate === null || typeof updated.openingBalanceDate === "string").toBe(
      true,
    );
  });

  it("bulk approves without flipping rows already approved", async () => {
    const pending = await make("Pending", false);
    const approved = await make("Approved", true);

    expect(await suppliers.setApprovalMany([pending.id, approved.id], true, ACTOR)).toBe(1);
    expect(await suppliers.total(undefined, { isApproved: false })).toBe(0);
  });

  it("ignores a soft-deleted supplier rather than reviving it", async () => {
    const gone = await make("Gone", false);
    await suppliers.remove(gone.id, ACTOR);

    expect(await suppliers.setApprovalMany([gone.id], true, ACTOR)).toBe(0);
  });
});
