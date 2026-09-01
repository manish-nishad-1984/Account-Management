import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserFormDialog } from "./UserFormDialog";
import { renderWithAuth, routeFetch } from "../../test/render";

/**
 * Real UUIDs, because the contract validates them as UUIDs. A readable stand-in
 * like "site-1" fails `uuidId` on an array ELEMENT, which renders nowhere —
 * the form simply refuses to submit with nothing on screen to say why.
 */
const SITE_1 = "11111111-1111-4111-8111-111111111111";
const SITE_2 = "22222222-2222-4222-8222-222222222222";
const COMPANY_1 = "33333333-3333-4333-8333-333333333333";

const OPTIONS = {
  sites: [
    { id: SITE_1, name: "Riverfront Phase 2" },
    { id: SITE_2, name: "Gota Housing" },
  ],
  companies: [{ id: COMPANY_1, name: "D H Infra" }],
};

const detail = (overrides: Record<string, unknown> = {}) => ({
  id: "user-1",
  userName: "manish",
  firstName: "Manish",
  lastName: "Dhaduk",
  email: "m@example.com",
  phoneNo: "9825012345",
  isActive: true,
  passwordIsLegacy: false,
  siteIds: [SITE_1],
  companyIds: [COMPANY_1],
  ...overrides,
});

const routes = (user = detail()) =>
  routeFetch([
    [/\/users\/options$/, OPTIONS],
    [/\/users\/[^/]+$/, user],
    [/\/users$/, user],
  ]);

const render = (userId: string | null, onClose = vi.fn()) => {
  renderWithAuth(<UserFormDialog open userId={userId} onClose={onClose} />, {
    permissions: ["user.view", "user.add", "user.edit"],
  });
  return { onClose };
};

const bodyOfMethod = (method: string) => {
  const call = vi
    .mocked(globalThis.fetch)
    .mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === method);
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : undefined;
};

describe("UserFormDialog", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const fillNewUser = async () => {
    await userEvent.type(screen.getByLabelText(/first name/i), "New");
    await userEvent.type(screen.getByLabelText(/last name/i), "Person");
    await userEvent.type(screen.getByLabelText(/email/i), "new@example.com");
    await userEvent.type(screen.getByLabelText(/phone/i), "9825011111");
    await userEvent.type(screen.getByLabelText(/username/i), "newperson");
  };

  it("posts a new user with the administrator-set password", async () => {
    routes();
    render(null);
    await screen.findByText("Riverfront Phase 2");

    await fillNewUser();
    await userEvent.type(screen.getByLabelText(/^password$/i), "Correct-Horse-9");
    await userEvent.click(screen.getByRole("button", { name: /create user/i }));

    await waitFor(() => expect(bodyOfMethod("POST")).toBeDefined());
    expect(bodyOfMethod("POST")).toMatchObject({
      userName: "newperson",
      password: "Correct-Horse-9",
    });
  });

  /**
   * The password policy is enforced by the same Zod schema the API uses, so a
   * short password never reaches the network.
   */
  it("refuses a password under 12 characters", async () => {
    routes();
    render(null);
    await screen.findByText("Riverfront Phase 2");

    await fillNewUser();
    await userEvent.type(screen.getByLabelText(/^password$/i), "short");
    await userEvent.click(screen.getByRole("button", { name: /create user/i }));

    expect(await screen.findByText(/at least 12 characters/i)).toBeInTheDocument();
    expect(bodyOfMethod("POST")).toBeUndefined();
  });

  it("refuses a password that uses fewer than three character classes", async () => {
    routes();
    render(null);
    await screen.findByText("Riverfront Phase 2");

    await fillNewUser();
    await userEvent.type(screen.getByLabelText(/^password$/i), "aaaaaaaaaaaaaa");
    await userEvent.click(screen.getByRole("button", { name: /create user/i }));

    expect(await screen.findByText(/at least three of/i)).toBeInTheDocument();
    expect(bodyOfMethod("POST")).toBeUndefined();
  });

  it("never prefills the password field when editing", async () => {
    routes();
    render("user-1");

    await waitFor(() => expect(screen.getByLabelText(/username/i)).toHaveValue("manish"));
    // Nothing to prefill it with — no read path returns the credential — and a
    // masked placeholder would submit as a password change.
    expect(screen.getByLabelText(/new password/i)).toHaveValue("");
  });

  /**
   * An edit that leaves the password blank must not blank the password. This is
   * why create and update use different schemas.
   */
  it("omits the password entirely when an edit leaves it blank", async () => {
    routes();
    render("user-1");

    await waitFor(() => expect(screen.getByLabelText(/first name/i)).toHaveValue("Manish"));
    await userEvent.clear(screen.getByLabelText(/first name/i));
    await userEvent.type(screen.getByLabelText(/first name/i), "Renamed");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(bodyOfMethod("PATCH")).toBeDefined());
    expect(bodyOfMethod("PATCH")).not.toHaveProperty("password");
    expect(bodyOfMethod("PATCH").firstName).toBe("Renamed");
  });

  it("sends a password on edit when one was typed", async () => {
    routes();
    render("user-1");

    await waitFor(() => expect(screen.getByLabelText(/username/i)).toHaveValue("manish"));
    await userEvent.type(screen.getByLabelText(/new password/i), "Correct-Horse-9");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(bodyOfMethod("PATCH")).toBeDefined());
    expect(bodyOfMethod("PATCH").password).toBe("Correct-Horse-9");
  });

  /**
   * These replace `User.SiteId` and `User.CompanyId`, which are CSV strings in
   * SQL Server parsed at every call site. They travel as arrays of ids.
   */
  it("sends site assignments as an array of ids, not a CSV string", async () => {
    routes();
    render("user-1");

    await waitFor(() => expect(screen.getByLabelText("Gota Housing")).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText("Gota Housing"));
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(bodyOfMethod("PATCH")).toBeDefined());
    expect(bodyOfMethod("PATCH").siteIds).toEqual([SITE_1, SITE_2]);
  });

  it("warns when the account still holds a legacy plaintext password", async () => {
    routes(detail({ passwordIsLegacy: true }));
    render("user-1");

    expect(await screen.findByText(/plaintext password carried over/i)).toBeInTheDocument();
  });

  it("normalises a pasted phone number before sending it", async () => {
    routes();
    render(null);
    await screen.findByText("Riverfront Phase 2");

    await userEvent.type(screen.getByLabelText(/first name/i), "New");
    await userEvent.type(screen.getByLabelText(/last name/i), "Person");
    await userEvent.type(screen.getByLabelText(/email/i), "new@example.com");
    await userEvent.type(screen.getByLabelText(/phone/i), "+91 98250 11111");
    await userEvent.type(screen.getByLabelText(/username/i), "newperson");
    await userEvent.type(screen.getByLabelText(/^password$/i), "Correct-Horse-9");
    await userEvent.click(screen.getByRole("button", { name: /create user/i }));

    await waitFor(() => expect(bodyOfMethod("POST")).toBeDefined());
    expect(bodyOfMethod("POST").phoneNo).toBe("9825011111");
  });
});
