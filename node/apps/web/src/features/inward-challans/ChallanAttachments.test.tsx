import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChallanAttachments } from "./ChallanAttachments";
import { json, noContent, renderWithAuth, routeFetch } from "../../test/render";

const CHALLAN = "11111111-1111-1111-1111-111111111111";
const DOCUMENT = "22222222-2222-2222-2222-222222222222";

const document_ = (overrides: Record<string, unknown> = {}) => ({
  id: DOCUMENT,
  documentName: "weighbridge.pdf",
  contentType: "application/pdf",
  sizeBytes: 245_760,
  isDownloadable: true,
  uploadedAt: "2026-09-07T10:00:00.000Z",
  ...overrides,
});

const detail = (documents: unknown[]) => ({
  id: CHALLAN,
  siteId: "33333333-3333-3333-3333-333333333333",
  itemId: "44444444-4444-4444-4444-444444444444",
  supplierId: null,
  unitId: 1,
  quantity: "4000.00",
  invoiceNo: "922",
  documentDate: null,
  vehicleNumber: null,
  receiverName: null,
  isApproved: false,
  createdAt: "2026-09-07T10:00:00.000Z",
  documents,
});

const file = (name: string, type: string, bytes = 1024) =>
  new File([new Uint8Array(bytes)], name, { type });

/** The upload request, whichever order the component made its calls in. */
const uploadCall = () =>
  vi
    .mocked(globalThis.fetch)
    .mock.calls.find((c) => String(c[0]).includes("/documents") && c[1]?.method === "POST");

describe("ChallanAttachments", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists what is attached, with its size", () => {
    routeFetch([]);
    renderWithAuth(<ChallanAttachments challanId={CHALLAN} documents={[document_()]} />);

    expect(screen.getByText("weighbridge.pdf")).toBeInTheDocument();
    expect(screen.getByText("240 KB")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download weighbridge.pdf" })).toBeInTheDocument();
  });

  it("says so when a challan has nothing attached", () => {
    routeFetch([]);
    renderWithAuth(<ChallanAttachments challanId={CHALLAN} documents={[]} />);

    expect(screen.getByText("Nothing attached yet.")).toBeInTheDocument();
  });

  /**
   * The ETL carries a file NAME and no location, because the source's own table
   * records nothing else. Offering a download that must 404 is worse than saying
   * where the file actually is.
   */
  it("offers no download for a file the old system kept", () => {
    routeFetch([]);
    renderWithAuth(
      <ChallanAttachments
        challanId={CHALLAN}
        documents={[
          document_({
            documentName: "old-scan.jpg",
            isDownloadable: false,
            contentType: null,
            sizeBytes: null,
          }),
        ]}
      />,
    );

    expect(screen.getByText("old-scan.jpg")).toBeInTheDocument();
    expect(screen.getByText("on the old server")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Download/ })).not.toBeInTheDocument();
  });

  describe("uploading", () => {
    it("posts the file as multipart, letting the browser set the boundary", async () => {
      routeFetch([[/\/documents$/, json(detail([document_()]))]]);
      renderWithAuth(<ChallanAttachments challanId={CHALLAN} documents={[]} />);

      await userEvent.upload(
        screen.getByLabelText("Choose files to attach"),
        file("challan.pdf", "application/pdf"),
      );

      await waitFor(() => expect(uploadCall()).toBeDefined());

      const [url, init] = uploadCall()!;
      expect(String(url)).toBe(`/api/v1/inward-challans/${CHALLAN}/documents`);
      expect(init!.body).toBeInstanceOf(FormData);

      // The field name the server reads.
      const form = init!.body as FormData;
      expect((form.getAll("files")[0] as File).name).toBe("challan.pdf");

      /**
       * A hand-set Content-Type here has no boundary parameter, and the server
       * then cannot find where one part ends and the next begins. The browser
       * must write this header itself.
       */
      expect(init!.headers).not.toHaveProperty("Content-Type");
    });

    it("sends several files in one request", async () => {
      routeFetch([[/\/documents$/, json(detail([document_()]))]]);
      renderWithAuth(<ChallanAttachments challanId={CHALLAN} documents={[]} />);

      await userEvent.upload(screen.getByLabelText("Choose files to attach"), [
        file("a.pdf", "application/pdf"),
        file("b.png", "image/png"),
      ]);

      await waitFor(() => expect(uploadCall()).toBeDefined());
      expect((uploadCall()![1]!.body as FormData).getAll("files")).toHaveLength(2);
    });

    /**
     * `accept` filters the file dialog, and `userEvent.upload` honours it — so a
     * disallowed file never reaches the handler through that path at all. That
     * is worth knowing and is asserted below, but `accept` is a HINT: a drag and
     * drop, a renamed file or a browser that ignores it all deliver the file
     * anyway. The change event is dispatched directly here so the JavaScript
     * guard behind the hint is the thing under test.
     */
    it("refuses a type that is not allowed, without calling the API", async () => {
      routeFetch([[/\/documents$/, json(detail([]))]]);
      renderWithAuth(<ChallanAttachments challanId={CHALLAN} documents={[]} />);

      const input = screen.getByLabelText("Choose files to attach");
      fireEvent.change(input, { target: { files: [file("page.html", "text/html")] } });

      expect(await screen.findByRole("alert")).toHaveTextContent(
        /\.html files cannot be attached/,
      );
      expect(uploadCall()).toBeUndefined();
    });

    it("names the allowed extensions on the input, so the file dialog filters too", async () => {
      routeFetch([]);
      renderWithAuth(<ChallanAttachments challanId={CHALLAN} documents={[]} />);

      const input = screen.getByLabelText("Choose files to attach");
      expect(input).toHaveAttribute("accept", expect.stringContaining(".pdf"));
      expect(input.getAttribute("accept")).not.toContain(".html");
      // .svg scripts in a browser and is the one that looks harmless.
      expect(input.getAttribute("accept")).not.toContain(".svg");
    });

    it("refuses a file over the size limit, naming the limit", async () => {
      routeFetch([[/\/documents$/, json(detail([]))]]);
      renderWithAuth(<ChallanAttachments challanId={CHALLAN} documents={[]} />);

      await userEvent.upload(
        screen.getByLabelText("Choose files to attach"),
        file("huge.pdf", "application/pdf", 11 * 1024 * 1024),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(/The limit is 10\.0 MB/);
      expect(uploadCall()).toBeUndefined();
    });

    /** The server's sentence names the file and the rule; a generic one does not. */
    it("shows the server's own reason when it refuses", async () => {
      routeFetch([
        [
          /\/documents$/,
          json({ message: `"invoice.pdf" is not a PDF. Its name says one thing and its contents say another.` }, 400),
        ],
      ]);
      renderWithAuth(<ChallanAttachments challanId={CHALLAN} documents={[]} />);

      await userEvent.upload(
        screen.getByLabelText("Choose files to attach"),
        file("invoice.pdf", "application/pdf"),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(/is not a PDF/);
    });
  });

  describe("downloading", () => {
    it("fetches the bytes rather than following a link", async () => {
      // The token is held in memory, so a browser-initiated navigation would
      // carry no credentials and the server would answer 401.
      const createObjectURL = vi.fn(() => "blob:test");
      const revokeObjectURL = vi.fn();
      vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));

      routeFetch([[/\/documents\//, new Response(new Blob(["%PDF-1.7"]), { status: 200 })]]);
      renderWithAuth(<ChallanAttachments challanId={CHALLAN} documents={[document_()]} />);

      await userEvent.click(screen.getByRole("button", { name: "Download weighbridge.pdf" }));

      await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
      const call = vi
        .mocked(globalThis.fetch)
        .mock.calls.find((c) => String(c[0]).includes("/documents/"));
      expect(String(call![0])).toBe(
        `/api/v1/inward-challans/${CHALLAN}/documents/${DOCUMENT}`,
      );

      // Leaking the object URL costs a copy of every file the user opens, for
      // the life of the page.
      await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:test"));
    });
  });

  describe("removing", () => {
    it("deletes through the challan, not by document id alone", async () => {
      routeFetch([[/\/documents\//, noContent()]]);
      renderWithAuth(<ChallanAttachments challanId={CHALLAN} documents={[document_()]} />);

      await userEvent.click(screen.getByRole("button", { name: "Remove weighbridge.pdf" }));

      await waitFor(() => {
        const call = vi
          .mocked(globalThis.fetch)
          .mock.calls.find((c) => c[1]?.method === "DELETE");
        expect(String(call![0])).toBe(
          `/api/v1/inward-challans/${CHALLAN}/documents/${DOCUMENT}`,
        );
      });
    });

    it("offers no attach or remove control without the edit right", () => {
      routeFetch([]);
      renderWithAuth(
        <ChallanAttachments challanId={CHALLAN} documents={[document_()]} canEdit={false} />,
      );

      expect(screen.queryByRole("button", { name: /^Remove/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Attach files/ })).not.toBeInTheDocument();
      // Viewing is still viewing.
      expect(screen.getByRole("button", { name: "Download weighbridge.pdf" })).toBeInTheDocument();
    });
  });
});
