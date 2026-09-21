import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanyFormDialog } from "./CompanyFormDialog";
import { AuthProvider } from "../../contexts/AuthContext";

const detail = {
  id: "company-1",
  name: "D H Infra",
  invoicePrefix: "DHI",
  gstNo: "24AAACD1234A1Z5",
  panNo: "AAACD1234A",
  address: "100, Navrangpura Road",
  area: "Navrangpura",
  cityId: 1,
  stateId: 24,
  countryId: 1,
  pincode: "380001",
  bankName: "HDFC Bank",
  bankBranch: "Navrangpura",
  accountNo: "50100000000001",
  ifscCode: "HDFC0001234",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function renderDialog(companyId: string | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <CompanyFormDialog open companyId={companyId} onClose={onClose} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { onClose };
}

const bodyOf = (call: number) => {
  const calls = vi.mocked(globalThis.fetch).mock.calls;
  return JSON.parse(String((calls[call]![1] as RequestInit).body));
};

const findCall = (method: string) =>
  vi
    .mocked(globalThis.fetch)
    .mock.calls.findIndex((call) => (call[1] as RequestInit | undefined)?.method === method);

describe("CompanyFormDialog", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts a new company to the companies endpoint", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(json(detail)));
    renderDialog(null);

    await userEvent.type(screen.getByLabelText(/company name/i), "New Company");
    await userEvent.click(screen.getByRole("button", { name: /create company/i }));

    await waitFor(() => expect(findCall("POST")).toBeGreaterThanOrEqual(0));
    const index = findCall("POST");
    expect(new URL(String(vi.mocked(globalThis.fetch).mock.calls[index]![0]), "http://x").pathname).toBe(
      "/api/v1/companies",
    );
    expect(bodyOf(index).name).toBe("New Company");
  });

  /**
   * The whole reason the edit form fetches the record instead of reusing the
   * grid row: the list payload has no bank details, so a form built from it
   * would submit them blank and wipe them.
   */
  it("loads the bank details that the list withholds", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(json(detail)));
    renderDialog("company-1");

    await waitFor(() =>
      expect(screen.getByLabelText(/account number/i)).toHaveValue("50100000000001"),
    );
    expect(screen.getByLabelText(/^ifsc$/i)).toHaveValue("HDFC0001234");
  });

  it("sends a PATCH, not a POST, when editing", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(json(detail)));
    renderDialog("company-1");

    await waitFor(() => expect(screen.getByLabelText(/company name/i)).toHaveValue("D H Infra"));
    await userEvent.clear(screen.getByLabelText(/company name/i));
    await userEvent.type(screen.getByLabelText(/company name/i), "Renamed Infra");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(findCall("PATCH")).toBeGreaterThanOrEqual(0));
    const index = findCall("PATCH");
    expect(new URL(String(vi.mocked(globalThis.fetch).mock.calls[index]![0]), "http://x").pathname).toBe(
      "/api/v1/companies/company-1",
    );
    expect(bodyOf(index).name).toBe("Renamed Infra");
    // The account number was never touched, but it must still be sent —
    // otherwise the partial update leaves it as it was, which is also correct,
    // but here the form holds it so it should round-trip unchanged.
    expect(bodyOf(index).accountNo).toBe("50100000000001");
  });

  /**
   * GST AND PAN HAVE NO FORMAT RULE — length is the only thing checked, and the
   * business asked for exactly that on 17 Sep 2026.
   *
   * This is the test that would have failed had the old GSTIN pattern been left
   * in place, so it is the one that locks the loosening in: a value that the
   * official format rejects outright must now save.
   */
  it("accepts a GST number that does not match the official format", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(json(detail)));
    renderDialog(null);

    await userEvent.type(screen.getByLabelText(/company name/i), "Odd GST Co");
    await userEvent.type(screen.getByLabelText(/gst number/i), "NOTAGST");
    await userEvent.type(screen.getByLabelText(/^pan$/i), "NOTAPAN");
    await userEvent.click(screen.getByRole("button", { name: /create company/i }));

    await waitFor(() => expect(findCall("POST")).not.toBe(-1));
    expect(bodyOf(findCall("POST")).gstNo).toBe("NOTAGST");
    expect(bodyOf(findCall("POST")).panNo).toBe("NOTAPAN");
  });

  /**
   * The cap is enforced by the input itself, so over-long text cannot be typed
   * in the first place. `maxLength` is what makes the limit felt as the box
   * stopping rather than as an error after the fact.
   */
  it("stops typing at the character limit on GST and PAN", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(json(detail)));
    renderDialog(null);

    const gst = screen.getByLabelText(/gst number/i) as HTMLInputElement;
    const pan = screen.getByLabelText(/^pan$/i) as HTMLInputElement;
    expect(gst.maxLength).toBe(15);
    expect(pan.maxLength).toBe(10);

    await userEvent.type(gst, "A1A1A2S5E4F15465999");
    expect(gst.value).toHaveLength(15);
  });

  it("requires a name", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(json(detail)));
    renderDialog(null);

    await userEvent.click(screen.getByRole("button", { name: /create company/i }));

    expect(await screen.findByText(/company name is required/i)).toBeInTheDocument();
    expect(findCall("POST")).toBe(-1);
  });

  /**
   * A duplicate GST number is refused by a PostgreSQL unique index, not by Zod,
   * but both arrive in the same `issues` shape — so it must land on the GST
   * field rather than in a generic banner.
   */
  it("attaches a server conflict to the field that caused it", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(
      json(
        {
          message: "Another company is already registered with this GST number",
          issues: [
            {
              path: "gstNo",
              message: "Another company is already registered with this GST number",
            },
          ],
        },
        409,
      ),
    ));
    renderDialog(null);

    await userEvent.type(screen.getByLabelText(/company name/i), "Duplicate Co");
    await userEvent.type(screen.getByLabelText(/gst number/i), "24AAACD1234A1Z5");
    await userEvent.click(screen.getByRole("button", { name: /create company/i }));

    expect(await screen.findByText(/already registered with this gst number/i)).toBeInTheDocument();
  });

  it("closes only after the save succeeds", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(() => Promise.resolve(json({ message: "Nope" }, 500)));
    const { onClose } = renderDialog(null);

    await userEvent.type(screen.getByLabelText(/company name/i), "Doomed Co");
    await userEvent.click(screen.getByRole("button", { name: /create company/i }));

    await screen.findByRole("alert");
    expect(onClose).not.toHaveBeenCalled();
  });
});
