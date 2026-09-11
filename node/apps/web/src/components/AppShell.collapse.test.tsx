import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { AuthContext } from "../contexts/AuthContext";
import { StaticRecordLayout } from "../contexts/RecordLayoutContext";
import { StaticSiteScope } from "../contexts/SiteScopeContext";

/**
 * THE RAIL COLLAPSES TO ICONS AND STAYS THAT WAY.
 *
 * The width is Tailwind's job and is not asserted here — jsdom applies no
 * stylesheet, so a test that reads the computed width proves only that the class
 * string was copied correctly. What IS asserted is everything jsdom can actually
 * settle: that the preference survives a remount, that it is kept per person,
 * that a collapsed link still has a name a screen reader can read, and that the
 * control says which way it will go.
 */

function renderShell({ userId = "u1" }: { userId?: string } = {}) {
  return render(
    <MemoryRouter initialEntries={["/suppliers"]}>
      <AuthContext.Provider
        value={{
          user: { id: userId, userName: "tester", permissions: ["supplier.view"] },
          isAuthenticated: true,
          isRestoring: false,
          login: vi.fn(),
          logout: vi.fn(),
        }}
      >
        <StaticRecordLayout layout="modal">
          <StaticSiteScope>
            <AppShell>
              <p>page</p>
            </AppShell>
          </StaticSiteScope>
        </StaticRecordLayout>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

const collapseButton = () =>
  screen.getByRole("button", { name: /(Collapse|Expand) navigation/ });

describe("collapsing the sidebar", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("opens expanded, with a control that offers to collapse it", () => {
    renderShell();
    expect(screen.getByRole("button", { name: "Collapse navigation" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("collapses when the control is pressed, and then offers to expand", async () => {
    renderShell();
    await userEvent.click(collapseButton());

    const button = screen.getByRole("button", { name: "Expand navigation" });
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("expands again", async () => {
    renderShell();
    await userEvent.click(collapseButton());
    await userEvent.click(collapseButton());

    expect(screen.getByRole("button", { name: "Collapse navigation" })).toBeInTheDocument();
  });

  /**
   * The point of the whole feature. Someone who collapses the rail has said they
   * want the width for their work; re-expanding it on every page load takes the
   * decision back off them.
   */
  it("is still collapsed after the shell is mounted again", async () => {
    const { unmount } = renderShell();
    await userEvent.click(collapseButton());
    unmount();

    renderShell();
    expect(screen.getByRole("button", { name: "Expand navigation" })).toBeInTheDocument();
  });

  it("is remembered per person, not per browser", async () => {
    const { unmount } = renderShell({ userId: "u1" });
    await userEvent.click(collapseButton());
    unmount();

    renderShell({ userId: "u2" });
    expect(screen.getByRole("button", { name: "Collapse navigation" })).toBeInTheDocument();
  });

  /**
   * The label is hidden with `lg:hidden` rather than removed, so it is still
   * there for the phone drawer — but hidden text carries no accessible name, so
   * the collapsed rail would be a column of unnamed icons without this.
   */
  it("names every link while the labels are hidden", async () => {
    renderShell();
    await userEvent.click(collapseButton());

    const link = screen.getByRole("link", { name: "Suppliers" });
    expect(link).toHaveAttribute("title", "Suppliers");
  });

  /** A browser that refuses storage must still render the shell. */
  it("survives storage that throws", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    renderShell();
    await userEvent.click(collapseButton());
    expect(screen.getByRole("button", { name: "Expand navigation" })).toBeInTheDocument();

    getItem.mockRestore();
    setItem.mockRestore();
  });

  /** The drawer control is the phone's, and is untouched by any of this. */
  it("leaves the phone drawer control alone", () => {
    renderShell();
    expect(screen.getByRole("button", { name: "Open navigation" })).toBeInTheDocument();
  });
});
