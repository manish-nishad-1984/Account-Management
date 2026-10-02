import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgencyFormDialog } from "./AgencyFormDialog";
import { renderWithAuth } from "../../test/render";

const AGENCY_ID = "11111111-1111-4111-8111-111111111111";

const WORK_TYPES = [
  { id: 4, name: "Plaster" },
  { id: 5, name: "Shuttering" },
  { id: 16, name: "Painting" },
];
const STATES = [
  { id: 24, name: "Gujarat" },
  { id: 27, name: "Maharashtra" },
];
const CITIES: Record<string, unknown[]> = {
  "24": [
    { id: 1, name: "Ahmedabad", stateId: 24 },
    { id: 2, name: "Surat", stateId: 24 },
  ],
  "27": [{ id: 3, name: "Pune", stateId: 27 }],
};

const DETAIL = {
  id: AGENCY_ID,
  name: "Shree Shuttering",
  workTypeIds: [5],
  address: "12, Ring Road",
  stateId: 24,
  cityId: 2,
  gstNo: null,
  panNo: null,
  bankName: null,
  accountNo: null,
  ifscCode: null,
  accountHolderName: null,
  isActive: true,
  primaryContact: { id: "c1", name: "Mahesh Parmar", designation: null, mobile: "9909988776", email: null },
  additionalContacts: [{ id: "c2", name: "Accounts", designation: "Clerk", mobile: null, email: null }],
};

/** Cities answer per state, and a work type once added is listed — as the API does. */
function serve() {
  const workTypes = [...WORK_TYPES];
  vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
    const url = new URL(String(input), "http://localhost");
    const json = (body: unknown) =>
      Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
    if (url.pathname.endsWith("/geography/states")) return json(STATES);
    if (url.pathname.endsWith("/geography/cities")) return json(CITIES[url.searchParams.get("stateId") ?? ""] ?? []);
    if (url.pathname.endsWith("/agencies/work-types")) {
      if ((init as RequestInit | undefined)?.method === "POST") {
        workTypes.push({ id: 99, name: "Fabrication" });
        return json({ id: 99, name: "Fabrication" });
      }
      return json(workTypes);
    }
    return json(DETAIL);
  });
}

const sent = (method: "POST" | "PATCH", path: RegExp) => {
  const call = vi
    .mocked(globalThis.fetch)
    .mock.calls.find(([url, init]) => path.test(String(url)) && (init as RequestInit | undefined)?.method === method);
  return call ? (JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>) : null;
};

const openNew = () =>
  renderWithAuth(<AgencyFormDialog open agencyId={null} onClose={() => {}} />, {
    permissions: ["agency.view", "agency.add"],
  });

describe("AgencyFormDialog", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    serve();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends the agency with its trades, state, city and both kinds of contact", async () => {
    const user = userEvent.setup();
    openNew();

    await user.type(screen.getByLabelText(/agency name/i), "ABC Construction");

    await user.click(screen.getByRole("button", { name: /work nature/i }));
    const panel = screen.getByRole("group", { name: "Work types" });
    await user.click(await within(panel).findByLabelText("Plaster"));
    await user.click(within(panel).getByLabelText("Painting"));

    await user.selectOptions(screen.getByLabelText(/^state/i), await screen.findByRole("option", { name: "Gujarat" }));
    await user.selectOptions(screen.getByLabelText(/^city/i), await screen.findByRole("option", { name: "Surat" }));

    await user.type(screen.getByLabelText(/contact name/i), "Ramesh Patel");
    await user.type(screen.getByLabelText(/mobile no/i), "+91 98765 43210");

    await user.click(screen.getByRole("button", { name: /add contact/i }));
    await user.type(screen.getByLabelText("Contact 1 name"), "Site supervisor");
    await user.type(screen.getByLabelText("Contact 1 mobile"), "9000000001");

    await user.click(screen.getByRole("button", { name: /save agency/i }));

    await waitFor(() => expect(sent("POST", /\/agencies$/)).not.toBeNull());
    expect(sent("POST", /\/agencies$/)).toMatchObject({
      name: "ABC Construction",
      workTypeIds: [4, 16],
      stateId: 24,
      cityId: 2,
      isActive: true,
      primaryContact: { name: "Ramesh Patel", mobile: "+91 98765 43210", designation: null, email: null },
      additionalContacts: [{ name: "Site supervisor", mobile: "9000000001", designation: null, email: null }],
    });
  });

  it("says what is missing and sends nothing", async () => {
    const user = userEvent.setup();
    openNew();

    await user.click(screen.getByRole("button", { name: /save agency/i }));

    expect(await screen.findByText("Agency name is required")).toBeInTheDocument();
    expect(screen.getByText("Choose at least one work type")).toBeInTheDocument();
    expect(screen.getByText("Choose a state")).toBeInTheDocument();
    expect(screen.getByText("Choose a city")).toBeInTheDocument();
    expect(screen.getByText("Contact name is required")).toBeInTheDocument();
    expect(screen.getByText("Mobile number is required")).toBeInTheDocument();
    expect(sent("POST", /\/agencies$/)).toBeNull();
  });

  it("clears the city when the person changes the state", async () => {
    const user = userEvent.setup();
    openNew();

    const state = screen.getByLabelText(/^state/i);
    await user.selectOptions(state, await screen.findByRole("option", { name: "Gujarat" }));
    await user.selectOptions(screen.getByLabelText(/^city/i), await screen.findByRole("option", { name: "Surat" }));
    await user.selectOptions(state, "27");

    expect(screen.getByLabelText(/^city/i)).toHaveValue("");
    expect(await screen.findByRole("option", { name: "Pune" })).toBeInTheDocument();
  });

  /**
   * The stored city is put into the form before its state's cities arrive. An
   * uncontrolled select would show blank and post "" — the city lost on every
   * save of an edited agency.
   */
  it("keeps the stored city on edit, though the cities load after the form", async () => {
    const user = userEvent.setup();
    renderWithAuth(<AgencyFormDialog open agencyId={AGENCY_ID} onClose={() => {}} />, {
      permissions: ["agency.view", "agency.edit"],
    });

    await waitFor(() => expect(screen.getByLabelText(/agency name/i)).toHaveValue("Shree Shuttering"));
    await waitFor(() => expect(screen.getByLabelText(/^city/i)).toHaveValue("2"));
    expect(screen.getByLabelText("Contact 1 name")).toHaveValue("Accounts");

    await user.click(screen.getByRole("button", { name: /save agency/i }));

    await waitFor(() => expect(sent("PATCH", /\/agencies\//)).not.toBeNull());
    expect(sent("PATCH", /\/agencies\//)).toMatchObject({ stateId: 24, cityId: 2, workTypeIds: [5] });
  });

  it("adds a new work type from the picker and ticks it", async () => {
    const user = userEvent.setup();
    openNew();

    await user.click(screen.getByRole("button", { name: /work nature/i }));
    await user.type(await screen.findByLabelText("New work type"), "Fabrication");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(sent("POST", /\/agencies\/work-types$/)).toEqual({ name: "Fabrication" }));
    expect(await screen.findByText("1 selected")).toBeInTheDocument();
  });
});
