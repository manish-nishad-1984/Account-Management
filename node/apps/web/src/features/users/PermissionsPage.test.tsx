import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionsPage } from "./PermissionsPage";
import { renderWithAuth, routeFetch } from "../../test/render";

const USERS = {
  rows: [
    {
      id: "user-1",
      userName: "manish",
      firstName: "Manish",
      lastName: "Dhaduk",
      email: "m@example.com",
      phoneNo: "9825012345",
      isActive: true,
      passwordIsLegacy: false,
      siteCount: 2,
      capabilities: { canEdit: true, canDelete: true, canApprove: false },
    },
  ],
  nextCursor: null,
  total: 1,
};

const matrix = (overrides: Record<string, unknown> = {}) => ({
  userId: "user-1",
  userName: "manish",
  rows: [
    {
      formId: 7,
      formName: "Supplier",
      formGroup: "Masters",
      subject: "supplier",
      isViewAllow: false,
      isAddAllow: false,
      isEditAllow: false,
      isDeleteAllow: false,
      isApproved: false,
      ...overrides,
    },
  ],
});

const routes = (permissions = matrix()) =>
  routeFetch([
    [/\/permissions$/, permissions],
    [/\/users$/, USERS],
  ]);

/** The rights this screen needs: user.view to read the matrix, user.edit to change it. */
const render = (granted = ["user.view", "user.edit"]) =>
  renderWithAuth(<PermissionsPage />, { permissions: granted });

const putBody = () => {
  const call = vi
    .mocked(globalThis.fetch)
    .mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PUT");
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : undefined;
};

const selectManish = async () =>
  userEvent.click(await screen.findByRole("button", { name: /manish/i }));

describe("PermissionsPage", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks you to choose a user before showing any matrix", async () => {
    routes();
    render();

    await screen.findByText("manish");
    expect(screen.getByText(/choose a user/i)).toBeInTheDocument();
  });

  it("loads the matrix for the selected user", async () => {
    routes();
    render();
    await selectManish();

    expect(await screen.findByText("Supplier")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /view on supplier/i })).not.toBeChecked();
  });

  /**
   * The rule this screen exists to keep: a right without View is unreachable,
   * because the screen it applies to cannot be opened. The server refuses the
   * combination outright, so the UI must never be able to produce it.
   */
  it("ticks View automatically when any other right is ticked", async () => {
    routes();
    render();
    await selectManish();
    await screen.findByText("Supplier");

    await userEvent.click(screen.getByRole("checkbox", { name: /edit on supplier/i }));

    expect(screen.getByRole("checkbox", { name: /view on supplier/i })).toBeChecked();
  });

  it("clears every other right when View is unticked", async () => {
    routes(matrix({ isViewAllow: true, isAddAllow: true, isEditAllow: true }));
    render();
    await selectManish();
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: /add on supplier/i })).toBeChecked(),
    );

    await userEvent.click(screen.getByRole("checkbox", { name: /view on supplier/i }));

    expect(screen.getByRole("checkbox", { name: /add on supplier/i })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /edit on supplier/i })).not.toBeChecked();
  });

  it("PUTs the whole matrix, not a diff", async () => {
    routes();
    render();
    await selectManish();
    await screen.findByText("Supplier");

    await userEvent.click(screen.getByRole("checkbox", { name: /add on supplier/i }));
    await userEvent.click(screen.getByRole("button", { name: /save permissions/i }));

    await waitFor(() => expect(putBody()).toBeDefined());
    expect(putBody().rows).toHaveLength(1);
    // View came along with Add, as the rule requires.
    expect(putBody().rows[0]).toMatchObject({ formId: 7, isViewAllow: true, isAddAllow: true });
  });

  it("keeps Save disabled until something actually changes", async () => {
    routes();
    render();
    await selectManish();
    await screen.findByText("Supplier");

    expect(screen.getByRole("button", { name: /saved/i })).toBeDisabled();

    await userEvent.click(screen.getByRole("checkbox", { name: /view on supplier/i }));
    expect(screen.getByRole("button", { name: /save permissions/i })).toBeEnabled();
  });

  /** A user with view but not edit sees the matrix and cannot change it. */
  it("is read-only without the Edit right, and says so", async () => {
    routes();
    render(["user.view"]);
    await selectManish();
    await screen.findByText("Supplier");

    expect(screen.getByRole("checkbox", { name: /view on supplier/i })).toBeDisabled();
    expect(screen.getByText(/view-only access to permissions/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save permissions/i })).not.toBeInTheDocument();
  });

  /**
   * Roles are absent on purpose: `User.RoleId` is a GUID while both role tables
   * key on an integer, so they cannot join, and nothing reads them. The screen
   * says so rather than leaving the reader to wonder where roles went.
   */
  it("explains why there are no roles", async () => {
    routes();
    render();
    await selectManish();
    await screen.findByText("Supplier");

    expect(screen.getByText(/roles are not shown/i)).toBeInTheDocument();
  });

  it("shows the permission subject the ticks produce", async () => {
    routes();
    render();
    await selectManish();

    expect(await screen.findByText("supplier.*")).toBeInTheDocument();
  });
});
