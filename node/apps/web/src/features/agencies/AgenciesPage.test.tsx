import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgenciesPage } from "./AgenciesPage";
import { renderWithAuth, routeFetch } from "../../test/render";

const CAPS = { canEdit: true, canDelete: true, canApprove: false };

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "ABC Construction",
  workTypes: [
    { id: 4, name: "Plaster" },
    { id: 16, name: "Painting" },
  ],
  cityName: "Ahmedabad",
  stateName: "Gujarat",
  primaryContactName: "Ramesh Patel",
  primaryContactMobile: "+91 98765 43210",
  isActive: true,
  capabilities: CAPS,
  ...overrides,
});

const LIST = {
  rows: [
    row(),
    row({
      id: "22222222-2222-4222-8222-222222222222",
      name: "BuildRight Solutions",
      workTypes: [{ id: 2, name: "RCC" }],
      isActive: false,
      primaryContactName: "Dipak Trivedi",
      primaryContactMobile: "+91 97277 88990",
    }),
  ],
  nextCursor: null,
  total: 2,
};

const SUMMARY = { total: 8, active: 7, inactive: 1, cities: [{ id: 1, name: "Ahmedabad" }, { id: 2, name: "Surat" }] };
const WORK_TYPES = [
  { id: 4, name: "Plaster" },
  { id: 2, name: "RCC" },
];

const serve = () =>
  routeFetch([
    [/\/agencies\/summary$/, SUMMARY],
    [/\/agencies\/work-types$/, WORK_TYPES],
    [/\/agencies$/, LIST],
    [/\/grid-preferences/, { columns: null }],
  ]);

const listRequests = () =>
  vi
    .mocked(globalThis.fetch)
    .mock.calls.map(([url]) => new URL(String(url), "http://localhost"))
    .filter((url) => url.pathname.endsWith("/agencies"));

describe("AgenciesPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    serve();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("counts every agency in the three tiles", async () => {
    renderWithAuth(<AgenciesPage />, { permissions: ["agency.view"] });

    expect(await screen.findByRole("button", { name: /total agencies\s*8/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /active agencies\s*7/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /inactive agencies\s*1/i })).toBeInTheDocument();
  });

  it("shows each agency's trades as tags, its city, contact and status", async () => {
    renderWithAuth(<AgenciesPage />, { permissions: ["agency.view"] });

    const abc = (await screen.findByText("ABC Construction")).closest("tr")!;
    expect(within(abc).getByText("Plaster")).toBeInTheDocument();
    expect(within(abc).getByText("Painting")).toBeInTheDocument();
    expect(within(abc).getByText("Ahmedabad")).toBeInTheDocument();
    expect(within(abc).getByText("Ramesh Patel")).toBeInTheDocument();
    expect(within(abc).getByText("+91 98765 43210")).toBeInTheDocument();
    expect(within(abc).getByText("Active")).toBeInTheDocument();

    const buildRight = screen.getByText("BuildRight Solutions").closest("tr")!;
    expect(within(buildRight).getByText("Inactive")).toBeInTheDocument();
  });

  it("filters to inactive agencies from the tile", async () => {
    const user = userEvent.setup();
    renderWithAuth(<AgenciesPage />, { permissions: ["agency.view"] });

    await user.click(await screen.findByRole("button", { name: /inactive agencies/i }));

    await waitFor(() =>
      expect(listRequests().some((url) => url.searchParams.get("isActive") === "false")).toBe(true),
    );
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue("inactive");
  });

  it("filters by work type and by city", async () => {
    const user = userEvent.setup();
    renderWithAuth(<AgenciesPage />, { permissions: ["agency.view"] });

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Work type" }),
      await screen.findByRole("option", { name: "RCC" }),
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "City" }),
      await screen.findByRole("option", { name: "Surat" }),
    );

    await waitFor(() =>
      expect(
        listRequests().some(
          (url) => url.searchParams.get("workTypeId") === "2" && url.searchParams.get("cityId") === "2",
        ),
      ).toBe(true),
    );
  });

  it("offers Add agency only to someone who may add one", async () => {
    const { unmount } = renderWithAuth(<AgenciesPage />, { permissions: ["agency.view"] });
    await screen.findByText("ABC Construction");
    expect(screen.queryByRole("button", { name: /add agency/i })).not.toBeInTheDocument();
    unmount();

    renderWithAuth(<AgenciesPage />, { permissions: ["agency.view", "agency.add"] });
    expect(await screen.findByRole("button", { name: /add agency/i })).toBeInTheDocument();
  });
});
