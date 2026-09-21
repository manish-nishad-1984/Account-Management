import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordLayoutProvider, useRecordLayout } from "./RecordLayoutContext";
import { RecordLayoutPicker } from "../components/RecordLayoutPicker";

const KEY = (user: string) => `accountbook.recordLayout.${user}`;

/** Reports the current layout, so a test can read it without a screen. */
function Probe() {
  const { layout, paneOpen } = useRecordLayout();
  return (
    <div>
      <span data-testid="layout">{layout}</span>
      <span data-testid="pane">{paneOpen ? "open" : "closed"}</span>
    </div>
  );
}

const mount = (userId: string | null = "u1") =>
  render(
    <RecordLayoutProvider userId={userId}>
      <RecordLayoutPicker />
      <Probe />
    </RecordLayoutProvider>,
  );

const sideBySide = () => screen.getByRole("radio", { name: /side by side/i });
const dialog = () => screen.getByRole("radio", { name: /dialog/i });
const fullPage = () => screen.getByRole("radio", { name: /full page/i });

describe("RecordLayoutProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * THE DEFAULT IS NOW THE WHOLE DECISION, which is why this test matters more
   * than it did.
   *
   * It was "modal" — the layout every screen originally shipped with — on the
   * argument that a preference nobody has expressed must not silently change how
   * the application works. That argument held while the header carried a picker
   * anyone could use to change their mind in one click.
   *
   * The picker is development-only since the redesign, so on the released build
   * this default is the only layout a user will ever see. The client chose full
   * page (16 Sep 2026): it is the layout the full-width form work was done for,
   * and at "modal" the released app would have had the new paint and none of the
   * room.
   */
  it("defaults to the full page layout", () => {
    mount();
    expect(screen.getByTestId("layout")).toHaveTextContent("page");
    expect(fullPage()).toHaveAttribute("aria-checked", "true");
  });

  it("remembers the choice", async () => {
    mount();
    await userEvent.click(sideBySide());

    expect(screen.getByTestId("layout")).toHaveTextContent("split");
    expect(window.localStorage.getItem(KEY("u1"))).toBe("split");
  });

  it("restores the stored choice on the next visit", () => {
    window.localStorage.setItem(KEY("u1"), "split");
    mount();
    expect(screen.getByTestId("layout")).toHaveTextContent("split");
    expect(sideBySide()).toHaveAttribute("aria-checked", "true");
  });

  /**
   * A site office shares a keyboard. One person preferring the split view must
   * not change how the screens open for whoever signs in next.
   */
  it("keeps the preference per user", () => {
    window.localStorage.setItem(KEY("u1"), "split");
    mount("u2");
    // u2 has expressed no preference, so u2 gets the default - not u1's.
    expect(screen.getByTestId("layout")).toHaveTextContent("page");
  });

  /**
   * The third layout has to survive a reload like the other two. It was added
   * after the stored-value check was written, and a validator that still knew
   * only two names would have silently answered "modal" on every visit after
   * the first — a preference that appears to be honoured until you refresh.
   */
  it("remembers and restores the full-page choice", async () => {
    const first = mount();
    await userEvent.click(fullPage());
    expect(screen.getByTestId("layout")).toHaveTextContent("page");
    expect(window.localStorage.getItem(KEY("u1"))).toBe("page");

    first.unmount();
    mount();
    expect(screen.getByTestId("layout")).toHaveTextContent("page");
  });

  it("ignores a stored value that is not a layout", () => {
    window.localStorage.setItem(KEY("u1"), "sideways");
    mount();
    expect(screen.getByTestId("layout")).toHaveTextContent("page");
  });

  /**
   * Storage throws in a private window and where site data is blocked. A
   * preference that cannot be remembered is not a reason to fail a render.
   */
  it("still renders when localStorage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    mount();
    expect(screen.getByTestId("layout")).toHaveTextContent("page");

    await userEvent.click(sideBySide());
    expect(screen.getByTestId("layout")).toHaveTextContent("split");
  });

  it("reports no open pane until one says otherwise", () => {
    mount();
    expect(screen.getByTestId("pane")).toHaveTextContent("closed");
  });
});

describe("RecordLayoutPicker", () => {
  beforeEach(() => window.localStorage.clear());

  it("is a radio group, so the three options read as one choice", () => {
    mount();
    const group = screen.getByRole("radiogroup", { name: /how records open/i });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("moves the checked state rather than accumulating it", async () => {
    mount();
    await userEvent.click(sideBySide());

    expect(sideBySide()).toHaveAttribute("aria-checked", "true");
    expect(dialog()).toHaveAttribute("aria-checked", "false");
    expect(fullPage()).toHaveAttribute("aria-checked", "false");
  });

  /**
   * Three options, one checked. A radio group that leaves the previous choice
   * checked alongside the new one tells a screen-reader user the application is
   * in two layouts at once — and with two options that is only ever half wrong,
   * which is why it is worth re-checking now that there is a third.
   */
  it("checks exactly one option whichever is chosen", async () => {
    mount();
    await userEvent.click(fullPage());

    const checked = screen.getAllByRole("radio").filter(
      (option) => option.getAttribute("aria-checked") === "true",
    );
    expect(checked).toHaveLength(1);
    expect(checked[0]).toBe(fullPage());
  });
});
