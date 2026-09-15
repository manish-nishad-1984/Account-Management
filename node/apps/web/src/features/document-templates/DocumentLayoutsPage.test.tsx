import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { presetLayout, type DocumentTemplate } from "@accountmanagement/contracts";
import { DocumentLayoutsPage } from "./DocumentLayoutsPage";
import { json, noContent, renderWithAuth } from "../../test/render";

const ALL = ["document-template.view", "document-template.add", "document-template.edit", "document-template.delete"];
const CAN = { canEdit: true, canDelete: true, canApprove: false };

const template = (overrides: Partial<DocumentTemplate> = {}): DocumentTemplate => ({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  documentType: "sales-invoice",
  companyId: null,
  companyName: null,
  name: "Our Classic",
  basedOn: "classic",
  isDefault: false,
  layout: presetLayout("classic", "sales-invoice"),
  updatedAt: "2026-09-14T10:00:00.000Z",
  capabilities: CAN,
  ...overrides,
});

type Call = { method: string; path: string; body: unknown };

/** Routes the page's requests and records every one, so a test can see what was written. */
function serve(rows: DocumentTemplate[]) {
  const calls: Call[] = [];
  vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    calls.push({ method, path: url.pathname + url.search, body: init?.body ? JSON.parse(String(init.body)) : undefined });

    if (url.pathname.endsWith("/companies")) {
      return json({ rows: [{ id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1", name: "DH PATEL", invoicePrefix: null, gstNo: null, panNo: null, area: null, pincode: null, bankName: null, userCount: 0, capabilities: CAN }], nextCursor: null, total: 1 });
    }
    if (method === "GET" && url.pathname.endsWith("/document-templates")) {
      const type = url.searchParams.get("documentType");
      return json({ rows: rows.filter((row) => row.documentType === type) });
    }
    if (method === "DELETE") return noContent();
    if (method === "POST" && url.pathname.endsWith("/document-templates")) {
      const body = JSON.parse(String(init!.body));
      return json(template({ ...body, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9", companyName: null }));
    }
    return json(rows[0]);
  });
  return calls;
}

const writes = (calls: Call[]) => calls.filter((call) => call.method !== "GET");

describe("DocumentLayoutsPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows a card for each template of the chosen document type", async () => {
    serve([
      template({ name: "Our Classic", isDefault: true }),
      template({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", name: "Purchase layout", documentType: "purchase-invoice" }),
    ]);
    renderWithAuth(<DocumentLayoutsPage />, { permissions: ALL });

    const card = await screen.findByRole("article", { name: "Our Classic" });
    expect(within(card).getByText("Default")).toBeInTheDocument();
    expect(within(card).getByText(/A4 portrait · Classic · All companies/)).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Purchase layout" })).not.toBeInTheDocument();
  });

  it("asks for purchase invoice templates on that tab", async () => {
    const user = userEvent.setup();
    const calls = serve([
      template({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", name: "Purchase layout", documentType: "purchase-invoice" }),
    ]);
    renderWithAuth(<DocumentLayoutsPage />, { permissions: ALL });

    await user.click(screen.getByRole("tab", { name: "Purchase Invoice" }));

    expect(await screen.findByRole("article", { name: "Purchase layout" })).toBeInTheDocument();
    expect(calls.some((call) => call.path.includes("documentType=purchase-invoice"))).toBe(true);
  });

  /** Until someone sets an all-companies default, the old invoice is what prints. */
  it("shows the built-in Classic while no all-companies default is set", async () => {
    serve([template()]);
    renderWithAuth(<DocumentLayoutsPage />, { permissions: ALL });

    expect(await screen.findByRole("article", { name: "Classic (built in)" })).toBeInTheDocument();
  });

  it("stops showing the built-in Classic once an all-companies default exists", async () => {
    serve([template({ isDefault: true })]);
    renderWithAuth(<DocumentLayoutsPage />, { permissions: ALL });

    await screen.findByRole("article", { name: "Our Classic" });
    expect(screen.queryByRole("article", { name: "Classic (built in)" })).not.toBeInTheDocument();
  });

  it("creates a template from the chosen starting layout", async () => {
    const user = userEvent.setup();
    const calls = serve([]);
    renderWithAuth(<DocumentLayoutsPage />, { permissions: ALL });

    await user.click(await screen.findByRole("button", { name: "Create template" }));
    await user.type(screen.getByLabelText(/template name/i), "Site invoice");
    await user.click(screen.getByRole("radio", { name: /modern/i }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create template" }));

    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    const [post] = writes(calls);
    expect(post).toMatchObject({
      method: "POST",
      path: "/api/v1/document-templates",
      body: { documentType: "sales-invoice", name: "Site invoice", basedOn: "modern", companyId: null },
    });
    expect((post!.body as { layout: unknown }).layout).toEqual(presetLayout("modern", "sales-invoice"));
  });

  it("makes a template the default with its star", async () => {
    const user = userEvent.setup();
    const calls = serve([template()]);
    renderWithAuth(<DocumentLayoutsPage />, { permissions: ALL });

    await user.click(await screen.findByRole("button", { name: "Make Our Classic the default" }));

    await waitFor(() =>
      expect(writes(calls)).toEqual([
        expect.objectContaining({ method: "PUT", path: `/api/v1/document-templates/${template().id}/default` }),
      ]),
    );
  });

  it("will not delete the default, and says why", async () => {
    serve([template({ isDefault: true })]);
    renderWithAuth(<DocumentLayoutsPage />, { permissions: ALL });

    expect(await screen.findByRole("button", { name: "The default cannot be deleted" })).toBeDisabled();
  });

  it("deletes after asking", async () => {
    const user = userEvent.setup();
    const calls = serve([template()]);
    renderWithAuth(<DocumentLayoutsPage />, { permissions: ALL });

    await user.click(await screen.findByRole("button", { name: "Delete Our Classic" }));
    expect(writes(calls)).toEqual([]);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(writes(calls)).toEqual([
        expect.objectContaining({ method: "DELETE", path: `/api/v1/document-templates/${template().id}` }),
      ]),
    );
  });

  it("duplicates a template", async () => {
    const user = userEvent.setup();
    const calls = serve([template()]);
    renderWithAuth(<DocumentLayoutsPage />, { permissions: ALL });

    await user.click(await screen.findByRole("button", { name: "Duplicate Our Classic" }));

    await waitFor(() =>
      expect(writes(calls)).toEqual([
        expect.objectContaining({ method: "POST", path: `/api/v1/document-templates/${template().id}/duplicate` }),
      ]),
    );
  });

  it("offers nothing that changes templates to someone who can only view them", async () => {
    serve([template()]);
    renderWithAuth(<DocumentLayoutsPage />, { permissions: ["document-template.view"] });

    await screen.findByRole("article", { name: "Our Classic" });
    expect(screen.queryByRole("button", { name: "Create template" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /duplicate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /default/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview Our Classic" })).toBeInTheDocument();
  });

  it("previews with sample data, without writing anything", async () => {
    const user = userEvent.setup();
    const calls = serve([template()]);
    renderWithAuth(<DocumentLayoutsPage />, { permissions: ALL });

    await user.click(await screen.findByRole("button", { name: "Preview Our Classic" }));

    const preview = screen.getByRole("region", { name: "Document preview" });
    // Bill to and Ship to both name the buyer.
    expect(within(preview).getAllByText("Sample Buyer Pvt Ltd").length).toBeGreaterThan(0);
    expect(writes(calls)).toEqual([]);
  });
});
