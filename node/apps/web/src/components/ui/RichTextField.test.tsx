import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { RichTextField } from "./RichTextField";

/**
 * WHAT THIS FILE CAN AND CANNOT PROVE.
 *
 * jsdom does not implement `document.execCommand` — the method is absent, not a
 * no-op — so the editor's actual formatting behaviour cannot be exercised here
 * at all. What is asserted is everything AROUND the command: that the button
 * issues the right one, that a missing implementation does not take the form
 * down, that a paste is flattened to text, and that an external value change
 * rewrites the document while a keystroke does not.
 *
 * The formatting itself is verified in a real browser. Stated here rather than
 * left to be discovered, because a green file named after an editor invites the
 * reading that the editor is covered.
 */

function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <RichTextField label="Terms" value={value} onChange={setValue} placeholder="Type the terms" />
      <button type="button" onClick={() => setValue("<p>From somewhere else</p>")}>
        Load
      </button>
      <output data-testid="value">{value}</output>
    </>
  );
}

const editor = () => screen.getByRole("textbox", { name: "Terms" });

afterEach(() => {
  vi.restoreAllMocks();
  // The stub is assigned onto a document that has no such method, so deleting
  // it is what restores the environment rather than `restoreAllMocks`.
  delete (document as unknown as { execCommand?: unknown }).execCommand;
});

const stubExecCommand = () => {
  const spy = vi.fn();
  (document as unknown as { execCommand: unknown }).execCommand = spy;
  return spy;
};

describe("the toolbar", () => {
  it("offers exactly the commands whose output survives the sanitiser", () => {
    render(<Harness />);

    for (const name of [
      "Bold",
      "Italic",
      "Underline",
      "Bulleted list",
      "Numbered list",
      "Clear formatting",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("issues the command the button stands for", async () => {
    const exec = stubExecCommand();
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Bulleted list" }));

    expect(exec).toHaveBeenCalledWith("insertUnorderedList", false);
  });

  /**
   * The editor must have focus when the command runs.
   *
   * `execCommand` acts on the document's selection, and a click on a toolbar
   * button has already moved focus off the editor by the time the click handler
   * runs — so without the explicit focus the command applies to nothing and the
   * button appears dead.
   */
  it("returns focus to the editor before running the command", async () => {
    const exec = stubExecCommand();
    exec.mockImplementation(() => {
      expect(document.activeElement).toBe(editor());
    });

    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Bold" }));

    expect(exec).toHaveBeenCalledOnce();
  });

  /** jsdom is one environment without it; a locked-down browser is another. */
  it("does not throw where execCommand does not exist", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await expect(user.click(screen.getByRole("button", { name: "Bold" }))).resolves.not.toThrow();
    expect(editor()).toBeInTheDocument();
  });
});

describe("the document", () => {
  it("reports what was typed", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(editor());
    await user.keyboard("Payment in 30 days");

    expect(screen.getByTestId("value")).toHaveTextContent("Payment in 30 days");
  });

  /**
   * The caret defect, pinned.
   *
   * A `contenteditable` cannot be a controlled input: rewriting it with the
   * value being typed replaces its child nodes and drops the caret to the start
   * on every keystroke, so text arrives reversed one character at a time. The
   * component only writes the DOM when the incoming value differs from what the
   * element already holds — and this asserts the outcome rather than the
   * mechanism, because the mechanism is what might be rewritten.
   */
  it("keeps typed text in order rather than reversing it", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(editor());
    await user.keyboard("abcdef");

    expect(editor()).toHaveTextContent("abcdef");
  });

  it("rewrites the document when the value changes from outside", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(editor());
    await user.keyboard("mine");
    await user.click(screen.getByRole("button", { name: "Load" }));

    expect(editor()).toHaveTextContent("From somewhere else");
  });

  it("starts from the value it is given", () => {
    render(<Harness initial="<p>Existing terms</p>" />);
    expect(editor()).toHaveTextContent("Existing terms");
  });
});

describe("pasting", () => {
  /**
   * A paste from a browser or a word processor carries styles, classes and often
   * a table of layout markup, nearly all of which the server strips on save — so
   * the pasted block would change shape after the fact. Flattening it at the
   * moment of paste is the same result, visible immediately.
   */
  it("inserts plain text, not the markup on the clipboard", async () => {
    const exec = stubExecCommand();
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(editor());
    await user.paste("Pasted clause");

    expect(exec).toHaveBeenCalledWith("insertText", false, "Pasted clause");
  });
});

describe("accessibility", () => {
  it("is a labelled multiline textbox, not an anonymous div", () => {
    render(<Harness />);

    const box = editor();
    expect(box).toHaveAttribute("aria-multiline", "true");
    expect(box).toHaveAttribute("contenteditable", "true");
  });

  it("announces the validation message rather than only colouring the border", () => {
    render(
      <RichTextField label="Terms" value="" onChange={() => {}} error="Terms are too long" />,
    );

    const box = screen.getByRole("textbox", { name: "Terms" });
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveAccessibleDescription("Terms are too long");
  });
});
