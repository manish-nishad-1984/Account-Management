import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { AuthContext } from "../contexts/AuthContext";
import { RecordLayoutProvider, type RecordLayout } from "../contexts/RecordLayoutContext";
import { StaticSiteScope } from "../contexts/SiteScopeContext";
import { FormDialog } from "./ui/FormDialog";

/**
 * THE SHELL'S HALF OF THE FULL-PAGE LAYOUT.
 *
 * `SuppliersPage.layout.test.tsx` covers what a screen does — the record opens,
 * the back arrow closes it, it is not a dialog. None of that touches the part
 * only the shell can do: putting the record somewhere that survives the list
 * being hidden, and hiding the list.
 *
 * Those two are a pair, and the failure if either half is wrong is not subtle —
 * it is a blank content area with no way out of it. That is worth its own file,
 * driven through the real `AppShell` and the real `FormDialog` rather than a
 * stand-in for either, because a stand-in is exactly where the pairing would
 * stop being tested.
 */

/** A screen: a list, and a record that may be open over it. */
function Harness({ layout }: { layout: RecordLayout }) {
  /*
   * Open state lives OUTSIDE `AppShell`, above the routed page, so it is not
   * lost when the shell hides that page — the same shape as a real screen,
   * whose `useMasterScreen` state is likewise unaffected by the hiding.
   */
  const [open, setOpen] = useState(false);

  return (
    <MemoryRouter initialEntries={["/"]}>
      <AuthContext.Provider
        value={{
          user: { id: "u1", userName: "tester", permissions: ["supplier.view"] },
          isAuthenticated: true,
          isRestoring: false,
        endedReason: null,
          login: vi.fn(),
          logout: vi.fn(),
        }}
      >
        <StaticSiteScope>
          <RecordLayoutProvider userId="u1" initialLayout={layout}>
            <AppShell>
              <button type="button" onClick={() => setOpen(true)}>
                Open record
              </button>
              <p>the list</p>
              <FormDialog
                open={open}
                onClose={() => setOpen(false)}
                onSubmit={vi.fn()}
                title="Bansal Traders"
                description="Supplier"
              >
                <p>the record</p>
              </FormDialog>
            </AppShell>
          </RecordLayoutProvider>
        </StaticSiteScope>
      </AuthContext.Provider>
    </MemoryRouter>
  );
}

const renderShell = (layout: RecordLayout) => {
  window.localStorage.clear();
  return render(<Harness layout={layout} />);
};

const openRecord = () => userEvent.click(screen.getByRole("button", { name: /open record/i }));

/** The wrapper the shell hides: the routed page's own container. */
const routedPage = () => screen.getByText("the list").parentElement as HTMLElement;

describe("a record that takes the page", () => {
  it("hides the list underneath it", async () => {
    renderShell("page");
    await openRecord();

    expect(await screen.findByText("the record")).toBeVisible();
    // `toBeVisible` walks the ancestors, so this asserts the hidden WRAPPER
    // through the text inside it, not the text's own styles.
    expect(screen.getByText("the list")).not.toBeVisible();
  });

  /**
   * HIDDEN, NOT UNMOUNTED. The list keeps its search, its sort, its cursor and
   * its loaded rows while the record is open, so the back arrow returns to the
   * screen the user left rather than to one that re-fetches itself. Unmounting
   * would look identical in a screenshot and be a different thing to use.
   */
  it("keeps the list mounted, so going back is a return and not a reload", async () => {
    renderShell("page");
    await openRecord();

    await screen.findByText("the record");
    expect(screen.getByText("the list")).toBeInTheDocument();
  });

  it("shows the list again when the record closes", async () => {
    renderShell("page");
    await openRecord();

    const page = await screen.findByRole("region", { name: /bansal traders/i });
    await userEvent.click(within(page).getByRole("button", { name: /back to list/i }));

    expect(screen.getByText("the list")).toBeVisible();
    expect(screen.queryByText("the record")).not.toBeInTheDocument();
  });

  /**
   * The record renders OUTSIDE the element that gets hidden.
   *
   * It is written by the screen, which is inside that element — so without the
   * portal the record would be hidden by the very flag it itself sets, and the
   * user would be looking at an empty content area with no way back. This is the
   * one assertion that would catch the portal being quietly dropped.
   */
  it("puts the record outside the part of the page it hides", async () => {
    renderShell("page");
    await openRecord();

    const record = await screen.findByText("the record");
    expect(routedPage().contains(record)).toBe(false);
  });

  /**
   * The other two layouts must be untouched by all of this. Both leave the list
   * on screen — that is the entire difference between them and this one — and a
   * `pageOpen` that leaked into either would blank the page behind the record.
   */
  it.each(["modal", "split"] as const)(
    "leaves the list visible in the %s layout",
    async (layout) => {
      renderShell(layout);
      await openRecord();

      expect(await screen.findByText("the record")).toBeVisible();
      expect(screen.getByText("the list")).toBeVisible();
    },
  );
});
