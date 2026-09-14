import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveAddresses, type AddressDraft } from "./api";
import type { SiteAddress } from "@accountmanagement/contracts";

/**
 * BRINGING A SITE'S ADDRESS LIST IN LINE WITH WHAT WAS EDITED.
 *
 * The site form holds the rows as plain state and hands the whole list over on
 * save, so this has to work out which are new, which changed, and which were
 * taken away. The tests that matter are the ones about what it does NOT send: a
 * site saved after a change to its name alone must not rewrite four address
 * rows, and each such write would be a row whose id changes underneath any
 * document that shows it.
 */

const SITE = "11111111-1111-1111-1111-111111111111";

const stored = (id: number, address: string): SiteAddress => ({
  id,
  siteId: SITE,
  address,
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const requests = () =>
  vi.mocked(globalThis.fetch).mock.calls.map((call) => {
    const [input, init] = call as [RequestInfo | URL, RequestInit | undefined];
    return {
      method: init?.method ?? "GET",
      url: new URL(String(input), "http://localhost").pathname,
      body: init?.body ? (JSON.parse(String(init.body)) as { address?: string }) : undefined,
    };
  });

describe("saveAddresses", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      if ((init?.method ?? "GET") === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      const sent = init?.body ? (JSON.parse(String(init.body)) as { address: string }) : null;
      return Promise.resolve(
        json({ id: 99, siteId: SITE, address: sent?.address ?? "" }),
      );
    });
  });

  afterEach(() => vi.restoreAllMocks());

  const run = (existing: SiteAddress[], next: AddressDraft[]) =>
    saveAddresses(SITE, existing, next);

  it("writes nothing when nothing has been touched", async () => {
    await run([stored(1, "Gate 2")], [{ id: 1, address: "Gate 2" }]);
    expect(requests()).toEqual([]);
  });

  it("posts a row that has no id yet", async () => {
    await run([], [{ id: null, address: "Warehouse B" }]);

    expect(requests()).toEqual([
      {
        method: "POST",
        url: `/api/v1/sites/${SITE}/addresses`,
        body: { address: "Warehouse B" },
      },
    ]);
  });

  it("patches a row whose text changed, and only that row", async () => {
    await run(
      [stored(1, "Gate 2"), stored(2, "Warehouse B")],
      [
        { id: 1, address: "Gate 2, behind the weighbridge" },
        { id: 2, address: "Warehouse B" },
      ],
    );

    expect(requests()).toEqual([
      {
        method: "PATCH",
        url: `/api/v1/sites/${SITE}/addresses/1`,
        body: { address: "Gate 2, behind the weighbridge" },
      },
    ]);
  });

  it("deletes a row that is no longer in the list", async () => {
    await run([stored(1, "Gate 2"), stored(2, "Warehouse B")], [{ id: 2, address: "Warehouse B" }]);

    expect(requests()).toEqual([
      { method: "DELETE", url: `/api/v1/sites/${SITE}/addresses/1`, body: undefined },
    ]);
  });

  /** Deleting last would leave the row briefly duplicated on the screen. */
  it("deletes before it writes", async () => {
    await run([stored(1, "Old yard")], [{ id: null, address: "New yard" }]);

    expect(requests().map((r) => r.method)).toEqual(["DELETE", "POST"]);
  });

  it("ignores a blank row someone added and did not fill in", async () => {
    await run([], [{ id: null, address: "   " }]);
    expect(requests()).toEqual([]);
  });

  it("trims what it sends", async () => {
    await run([], [{ id: null, address: "  Warehouse B  " }]);
    expect(requests()[0]!.body).toEqual({ address: "Warehouse B" });
  });

  it("keeps the order the rows were listed in", async () => {
    await run(
      [],
      [
        { id: null, address: "First" },
        { id: null, address: "Second" },
        { id: null, address: "Third" },
      ],
    );

    expect(requests().map((r) => r.body?.address)).toEqual(["First", "Second", "Third"]);
  });
});
