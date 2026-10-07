import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AmountField, groupAmount } from "./AmountField";

describe("groupAmount", () => {
  it("groups the whole part the Indian way and leaves the decimals as typed", () => {
    expect(groupAmount("")).toBe("");
    expect(groupAmount("5")).toBe("5");
    expect(groupAmount("1000")).toBe("1,000");
    expect(groupAmount("125000")).toBe("1,25,000");
    expect(groupAmount("12345678.5")).toBe("1,23,45,678.5");
    expect(groupAmount("100.")).toBe("100.");
    expect(groupAmount("0.10")).toBe("0.10");
    expect(groupAmount("-12500")).toBe("-12,500");
  });
});

function Host() {
  const [raw, setRaw] = useState("");
  return (
    <>
      <AmountField label="Amount" value={raw} onValue={setRaw} />
      <output aria-label="held">{raw}</output>
    </>
  );
}

describe("AmountField", () => {
  it("shows commas but holds the plain figure", async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.type(screen.getByLabelText("Amount"), "1250000.5");

    expect(screen.getByLabelText("Amount")).toHaveValue("12,50,000.5");
    expect(screen.getByLabelText("held")).toHaveTextContent("1250000.5");
  });

  it("keeps the caret where it was when a comma appears in the middle", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const box = screen.getByLabelText("Amount") as HTMLInputElement;

    await user.type(box, "1000");
    expect(box).toHaveValue("1,000");
    // Put the caret after the first digit and type a 2: "12,000", caret after the 2.
    box.setSelectionRange(1, 1);
    await user.keyboard("2");
    expect(box).toHaveValue("12,000");
    expect(box.selectionStart).toBe(2);
  });

  it("takes a pasted figure with a currency sign and commas", async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.click(screen.getByLabelText("Amount"));
    await user.paste("Rs 1,25,000");

    expect(screen.getByLabelText("held")).toHaveTextContent("125000");
  });
});
