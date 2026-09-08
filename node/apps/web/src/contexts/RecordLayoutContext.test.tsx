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

describe("RecordLayoutProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * The layout every screen shipped with. A preference nobody has expressed must
   * not silently change how the application works.
   */
  it("defaults to the dialog layout", () => {
    mount();
    expect(screen.getByTestId("layout")).toHaveTextContent("modal");
    expect(dialog()).toHaveAttribute("aria-checked", "true");
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
    expect(screen.getByTestId("layout")).toHaveTextContent("modal");
  });

  it("ignores a stored value that is not a layout", () => {
    window.localStorage.setItem(KEY("u1"), "sideways");
    mount();
    expect(screen.getByTestId("layout")).toHaveTextContent("modal");
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
    expect(screen.getByTestId("layout")).toHaveTextContent("modal");

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

  it("is a radio group, so the two options read as one choice", () => {
    mount();
    const group = screen.getByRole("radiogroup", { name: /how records open/i });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("moves the checked state rather than accumulating it", async () => {
    mount();
    await userEvent.click(sideBySide());

    expect(sideBySide()).toHaveAttribute("aria-checked", "true");
    expect(dialog()).toHaveAttribute("aria-checked", "false");
  });
});
